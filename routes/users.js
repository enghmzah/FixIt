const express = require('express');
const { body, query, validationResult } = require('express-validator');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Review = require('../models/Review');
const { authenticateUser, requireRole, requireOwnershipOrAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// @desc    Get all users (Admin only)
// @route   GET /api/users
// @access  Private (Admin)
router.get('/', authenticateUser, requireRole('admin'), [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('role').optional().isIn(['client', 'provider', 'admin']),
  query('search').optional().trim()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const { role, search } = req.query;

  // Build query
  let query = {};
  
  if (role) {
    query.role = role;
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
  }

  // Get users with pagination
  const users = await User.find(query)
    .select('-firebaseUid')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await User.countDocuments(query);

  res.json({
    success: true,
    data: {
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
}));

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private

router.get('/:id', authenticateUser, asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('-firebaseUid');

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Check if user can view this profile
  const canView = req.user.role === 'admin' || 
                  req.user._id.toString() === user._id.toString() ||
                  user.role === 'provider'; // Providers are public

  if (!canView) {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  // Get additional data for providers
  let additionalData = {};
  if (user.role === 'provider') {
    // Get provider statistics
    const totalBookings = await Booking.countDocuments({ provider: user._id });
    const completedBookings = await Booking.countDocuments({ 
      provider: user._id, 
      status: 'completed' 
    });
    const averageRating = await Review.getProviderAverageRating(user._id);

    additionalData = {
      stats: {
        totalBookings,
        completedBookings,
        averageRating: averageRating.averageRating,
        totalReviews: averageRating.totalReviews
      }
    };
  }

  res.json({
    success: true,
    data: {
      user: {
        ...user.toObject(),
        ...additionalData
      }
    }
  });
}));

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private
router.put('/:id', authenticateUser, [
  body('name').optional().trim().isLength({ min: 2, max: 50 }),
  body('phone').optional().isMobilePhone(),
  body('isActive').optional().isBoolean(),
  body('isVerified').optional().isBoolean()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const user = await User.findById(req.params.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Check permissions
  const isOwner = req.user._id.toString() === user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  const { name, phone, location, language, notifications, isActive, isVerified } = req.body;

  // Update fields based on permissions
  if (name) user.name = name;
  if (phone) user.phone = phone;
  if (location) user.location = location;
  if (language) user.language = language;
  if (notifications) user.notifications = { ...user.notifications, ...notifications };

  // Admin-only fields
  if (isAdmin) {
    if (typeof isActive === 'boolean') user.isActive = isActive;
    if (typeof isVerified === 'boolean') user.isVerified = isVerified;
  }

  await user.save();

  res.json({
    success: true,
    message: 'User updated successfully',
    data: {
      user: user.toObject()
    }
  });
}));

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private (Admin only)
router.delete('/:id', authenticateUser, requireRole('admin'), asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Soft delete by deactivating
  user.isActive = false;
  await user.save();

  res.json({
    success: true,
    message: 'User deactivated successfully'
  });
}));

// @desc    Get providers
// @route   GET /api/users/providers
// @access  Public
router.get('/role/providers', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('city').optional().trim(),
  query('governorate').optional().trim(),
  query('service').optional().trim(),
  query('rating').optional().isFloat({ min: 0, max: 5 }),
  query('featured').optional().isBoolean()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const { city, governorate, service, rating, featured } = req.query;

  // Build query
  let query = {
    role: 'provider',
    isActive: true,
    'providerInfo.isActivated': true
  };

  if (city) {
    query['location.city'] = { $regex: city, $options: 'i' };
  }

  if (governorate) {
    query['location.governorate'] = { $regex: governorate, $options: 'i' };
  }

  if (rating) {
    query['providerInfo.rating.average'] = { $gte: parseFloat(rating) };
  }

  if (featured === 'true') {
    query['providerInfo.featured'] = true;
  }

  // Get providers
  const providers = await User.find(query)
    .select('name avatar location providerInfo createdAt')
    .populate('providerInfo.services', 'name category pricing')
    .sort({ 
      'providerInfo.featured': -1,
      'providerInfo.rating.average': -1,
      createdAt: -1 
    })
    .skip(skip)
    .limit(limit);

  const total = await User.countDocuments(query);

  res.json({
    success: true,
    data: {
      providers,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
}));

// @desc    Get provider dashboard data
// @route   GET /api/users/provider/dashboard
// @access  Private (Provider only)
router.get('/provider/dashboard', authenticateUser, requireRole('provider'), asyncHandler(async (req, res) => {
  const providerId = req.user._id;

  // Get booking statistics
  const totalBookings = await Booking.countDocuments({ provider: providerId });
  const pendingBookings = await Booking.countDocuments({ 
    provider: providerId, 
    status: 'pending' 
  });
  const completedBookings = await Booking.countDocuments({ 
    provider: providerId, 
    status: 'completed' 
  });
  const todayBookings = await Booking.countDocuments({
    provider: providerId,
    scheduledDate: {
      $gte: new Date().setHours(0, 0, 0, 0),
      $lt: new Date().setHours(23, 59, 59, 999)
    }
  });

  // Get recent bookings
  const recentBookings = await Booking.find({ provider: providerId })
    .populate('client', 'name avatar phone')
    .populate('service', 'name')
    .sort({ createdAt: -1 })
    .limit(5);

  // Get rating statistics
  const ratingStats = await Review.getProviderAverageRating(providerId);

  // Get earnings this month
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const monthlyEarnings = await Booking.aggregate([
    {
      $match: {
        provider: providerId,
        status: 'completed',
        'confirmation.clientConfirmed': true,
        createdAt: { $gte: startOfMonth }
      }
    },
    {
      $group: {
        _id: null,
        totalEarnings: { $sum: '$pricing.servicePrice' }
      }
    }
  ]);

  res.json({
    success: true,
    data: {
      stats: {
        totalBookings,
        pendingBookings,
        completedBookings,
        todayBookings,
        rating: ratingStats.averageRating,
        totalReviews: ratingStats.totalReviews,
        monthlyEarnings: monthlyEarnings.length > 0 ? monthlyEarnings[0].totalEarnings : 0,
        wallet: req.user.providerInfo.wallet
      },
      recentBookings
    }
  });
}));

// @desc    Get client dashboard data
// @route   GET /api/users/client/dashboard
// @access  Private (Client only)
router.get('/client/dashboard', authenticateUser, requireRole('client'), asyncHandler(async (req, res) => {
  const clientId = req.user._id;

  // Get booking statistics
  const totalBookings = await Booking.countDocuments({ client: clientId });
  const activeBookings = await Booking.countDocuments({ 
    client: clientId, 
    status: { $in: ['pending', 'accepted', 'in_progress'] }
  });
  const completedBookings = await Booking.countDocuments({ 
    client: clientId, 
    status: 'completed' 
  });

  // Get recent bookings
  const recentBookings = await Booking.find({ client: clientId })
    .populate('provider', 'name avatar phone providerInfo.rating')
    .populate('service', 'name category')
    .sort({ createdAt: -1 })
    .limit(5);

  // Get favorite providers
  const favoriteProviders = await User.find({
    _id: { $in: req.user.clientInfo.favoriteProviders }
  }).select('name avatar providerInfo.rating providerInfo.businessName');

  res.json({
    success: true,
    data: {
      stats: {
        totalBookings,
        activeBookings,
        completedBookings
      },
      recentBookings,
      favoriteProviders
    }
  });
}));

// @desc    Add provider to favorites
// @route   POST /api/users/favorites/:providerId
// @access  Private (Client only)
router.post('/favorites/:providerId', authenticateUser, requireRole('client'), asyncHandler(async (req, res) => {
  const { providerId } = req.params;
  const client = req.user;

  // Check if provider exists
  const provider = await User.findOne({ _id: providerId, role: 'provider' });
  if (!provider) {
    return res.status(404).json({
      success: false,
      message: 'Provider not found'
    });
  }

  // Check if already in favorites
  if (client.clientInfo.favoriteProviders.includes(providerId)) {
    return res.status(400).json({
      success: false,
      message: 'Provider already in favorites'
    });
  }

  // Add to favorites
  client.clientInfo.favoriteProviders.push(providerId);
  await client.save();

  res.json({
    success: true,
    message: 'Provider added to favorites'
  });
}));

// @desc    Remove provider from favorites
// @route   DELETE /api/users/favorites/:providerId
// @access  Private (Client only)
router.delete('/favorites/:providerId', authenticateUser, requireRole('client'), asyncHandler(async (req, res) => {
  const { providerId } = req.params;
  const client = req.user;

  // Remove from favorites
  client.clientInfo.favoriteProviders = client.clientInfo.favoriteProviders.filter(
    id => id.toString() !== providerId
  );
  await client.save();

  res.json({
    success: true,
    message: 'Provider removed from favorites'
  });
}));

module.exports = router;

