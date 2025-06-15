const express = require('express');
const { body, query, validationResult } = require('express-validator');
const User = require('../models/User');
const Service = require('../models/Service');
const Booking = require('../models/Booking');
const Review = require('../models/Review');
const Payment = require('../models/Payment');
const { authenticateUser, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// All routes require admin role
router.use(authenticateUser);
router.use(requireRole('admin'));

// @desc    Get dashboard statistics
// @route   GET /api/admin/dashboard
// @access  Private (Admin only)
router.get('/dashboard', asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));

  // User statistics
  const totalUsers = await User.countDocuments();
  const totalClients = await User.countDocuments({ role: 'client' });
  const totalProviders = await User.countDocuments({ role: 'provider' });
  const activatedProviders = await User.countDocuments({ 
    role: 'provider', 
    'providerInfo.isActivated': true 
  });
  const newUsersThisMonth = await User.countDocuments({
    createdAt: { $gte: startOfMonth }
  });

  // Service statistics
  const totalServices = await Service.countDocuments();
  const activeServices = await Service.countDocuments({ isActive: true, isApproved: true });
  const pendingServices = await Service.countDocuments({ isApproved: false, isActive: true });

  // Booking statistics
  const totalBookings = await Booking.countDocuments();
  const completedBookings = await Booking.countDocuments({ status: 'completed' });
  const activeBookings = await Booking.countDocuments({ 
    status: { $in: ['pending', 'accepted', 'in_progress'] }
  });
  const disputedBookings = await Booking.countDocuments({ status: 'disputed' });
  const bookingsThisMonth = await Booking.countDocuments({
    createdAt: { $gte: startOfMonth }
  });

  // Revenue statistics
  const revenueStats = await Payment.getPlatformRevenue(startOfMonth, now);
  const totalRevenue = await Payment.aggregate([
    {
      $match: {
        type: 'booking_payment',
        status: 'completed'
      }
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$breakdown.platformFee' }
      }
    }
  ]);

  // Review statistics
  const totalReviews = await Review.countDocuments();
  const flaggedReviews = await Review.countDocuments({ isFlagged: true });

  // Recent activity
  const recentBookings = await Booking.find()
    .populate('client', 'name')
    .populate('provider', 'name')
    .populate('service', 'name')
    .sort({ createdAt: -1 })
    .limit(5);

  const recentUsers = await User.find()
    .select('name email role createdAt')
    .sort({ createdAt: -1 })
    .limit(5);

  res.json({
    success: true,
    data: {
      stats: {
        users: {
          total: totalUsers,
          clients: totalClients,
          providers: totalProviders,
          activatedProviders,
          newThisMonth: newUsersThisMonth
        },
        services: {
          total: totalServices,
          active: activeServices,
          pending: pendingServices
        },
        bookings: {
          total: totalBookings,
          completed: completedBookings,
          active: activeBookings,
          disputed: disputedBookings,
          thisMonth: bookingsThisMonth
        },
        revenue: {
          total: totalRevenue.length > 0 ? totalRevenue[0].totalRevenue : 0,
          thisMonth: revenueStats.totalRevenue,
          transactionsThisMonth: revenueStats.totalTransactions
        },
        reviews: {
          total: totalReviews,
          flagged: flaggedReviews
        }
      },
      recentActivity: {
        bookings: recentBookings,
        users: recentUsers
      }
    }
  });
}));

// @desc    Get pending services for approval
// @route   GET /api/admin/services/pending
// @access  Private (Admin only)
router.get('/services/pending', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const services = await Service.find({ 
    isApproved: false, 
    isActive: true 
  })
  .populate('provider', 'name email providerInfo.businessName')
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit);

  const total = await Service.countDocuments({ 
    isApproved: false, 
    isActive: true 
  });

  res.json({
    success: true,
    data: {
      services,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
}));

// @desc    Get disputed bookings
// @route   GET /api/admin/bookings/disputed
// @access  Private (Admin only)
router.get('/bookings/disputed', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const bookings = await Booking.find({ status: 'disputed' })
    .populate('client', 'name email phone')
    .populate('provider', 'name email phone providerInfo.businessName')
    .populate('service', 'name category')
    .sort({ 'dispute.disputedAt': -1 })
    .skip(skip)
    .limit(limit);

  const total = await Booking.countDocuments({ status: 'disputed' });

  res.json({
    success: true,
    data: {
      bookings,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
}));

// @desc    Resolve dispute
// @route   PUT /api/admin/bookings/:id/resolve-dispute
// @access  Private (Admin only)
router.put('/bookings/:id/resolve-dispute', [
  body('resolution').notEmpty().trim(),
  body('refundAmount').optional().isFloat({ min: 0 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    return res.status(404).json({
      success: false,
      message: 'Booking not found'
    });
  }

  if (booking.status !== 'disputed') {
    return res.status(400).json({
      success: false,
      message: 'Booking is not disputed'
    });
  }

  const { resolution, refundAmount } = req.body;

  // Resolve dispute
  booking.dispute.resolution = {
    resolvedBy: req.user._id,
    resolvedAt: new Date(),
    resolution,
    refundAmount: refundAmount || 0
  };

  // Update booking status
  booking.updateStatus('completed', req.user._id, 'Dispute resolved by admin');

  await booking.save();

  // Process refund if specified
  if (refundAmount && refundAmount > 0) {
    await Payment.create({
      type: 'refund',
      user: booking.client,
      booking: booking._id,
      amount: refundAmount,
      currency: 'EGP',
      method: 'admin_refund',
      description: `Dispute resolution refund for booking ${booking.bookingId}`,
      status: 'completed'
    });
  }

  res.json({
    success: true,
    message: 'Dispute resolved successfully',
    data: {
      booking
    }
  });
}));

// @desc    Get platform analytics
// @route   GET /api/admin/analytics
// @access  Private (Admin only)
router.get('/analytics', [
  query('period').optional().isIn(['week', 'month', 'quarter', 'year']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601()
], asyncHandler(async (req, res) => {
  const { period = 'month', startDate, endDate } = req.query;

  let start, end;
  const now = new Date();

  if (startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
  } else {
    switch (period) {
      case 'week':
        start = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'quarter':
        start = new Date(now.setMonth(now.getMonth() - 3));
        break;
      case 'year':
        start = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      case 'month':
      default:
        start = new Date(now.setMonth(now.getMonth() - 1));
        break;
    }
    end = new Date();
  }

  // User growth analytics
  const userGrowth = await User.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        },
        clients: {
          $sum: { $cond: [{ $eq: ['$role', 'client'] }, 1, 0] }
        },
        providers: {
          $sum: { $cond: [{ $eq: ['$role', 'provider'] }, 1, 0] }
        },
        total: { $sum: 1 }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
  ]);

  // Booking analytics
  const bookingAnalytics = await Booking.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        },
        totalBookings: { $sum: 1 },
        completedBookings: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        },
        totalRevenue: { $sum: '$pricing.totalAmount' },
        platformRevenue: { $sum: '$pricing.platformFee' }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
  ]);

  // Service category analytics
  const categoryAnalytics = await Service.aggregate([
    {
      $match: {
        isActive: true,
        isApproved: true
      }
    },
    {
      $group: {
        _id: '$category',
        count: { $sum: 1 },
        avgRating: { $avg: '$stats.rating.average' },
        totalBookings: { $sum: '$stats.totalBookings' }
      }
    },
    { $sort: { count: -1 } }
  ]);

  // Top providers
  const topProviders = await User.aggregate([
    {
      $match: {
        role: 'provider',
        'providerInfo.isActivated': true
      }
    },
    {
      $project: {
        name: 1,
        'providerInfo.businessName': 1,
        'providerInfo.rating': 1,
        'providerInfo.wallet.totalEarnings': 1,
        totalBookings: { $size: { $ifNull: ['$providerInfo.services', []] } }
      }
    },
    { $sort: { 'providerInfo.wallet.totalEarnings': -1 } },
    { $limit: 10 }
  ]);

  res.json({
    success: true,
    data: {
      period: { start, end },
      userGrowth,
      bookingAnalytics,
      categoryAnalytics,
      topProviders
    }
  });
}));

// @desc    Manage user account
// @route   PUT /api/admin/users/:id/manage
// @access  Private (Admin only)
router.put('/users/:id/manage', [
  body('action').isIn(['activate', 'deactivate', 'verify', 'unverify', 'feature', 'unfeature']),
  body('reason').optional().trim()
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

  const { action, reason } = req.body;

  switch (action) {
    case 'activate':
      user.isActive = true;
      break;
    case 'deactivate':
      user.isActive = false;
      break;
    case 'verify':
      user.isVerified = true;
      break;
    case 'unverify':
      user.isVerified = false;
      break;
    case 'feature':
      if (user.role === 'provider') {
        user.providerInfo.featured = true;
      }
      break;
    case 'unfeature':
      if (user.role === 'provider') {
        user.providerInfo.featured = false;
      }
      break;
  }

  await user.save();

  res.json({
    success: true,
    message: `User ${action}d successfully`,
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        isVerified: user.isVerified,
        ...(user.role === 'provider' && {
          featured: user.providerInfo.featured
        })
      }
    }
  });
}));

// @desc    Get system logs
// @route   GET /api/admin/logs
// @access  Private (Admin only)
router.get('/logs', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('level').optional().isIn(['error', 'warn', 'info', 'debug']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601()
], asyncHandler(async (req, res) => {
  // This would typically integrate with a logging service
  // For now, return mock data
  const logs = [
    {
      id: '1',
      timestamp: new Date(),
      level: 'info',
      message: 'User registration completed',
      userId: '507f1f77bcf86cd799439011',
      metadata: { action: 'register', role: 'client' }
    },
    {
      id: '2',
      timestamp: new Date(Date.now() - 3600000),
      level: 'error',
      message: 'Payment processing failed',
      userId: '507f1f77bcf86cd799439012',
      metadata: { paymentId: 'PAY123', error: 'Card declined' }
    }
  ];

  res.json({
    success: true,
    data: {
      logs,
      pagination: {
        page: 1,
        limit: 20,
        total: logs.length,
        pages: 1
      }
    }
  });
}));

// @desc    Export data
// @route   GET /api/admin/export
// @access  Private (Admin only)
router.get('/export', [
  query('type').isIn(['users', 'bookings', 'payments', 'reviews']),
  query('format').optional().isIn(['csv', 'json']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601()
], asyncHandler(async (req, res) => {
  const { type, format = 'json', startDate, endDate } = req.query;

  let query = {};
  if (startDate && endDate) {
    query.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  let data;
  let filename;

  switch (type) {
    case 'users':
      data = await User.find(query).select('-firebaseUid -fcmToken');
      filename = `users_export_${Date.now()}`;
      break;
    case 'bookings':
      data = await Booking.find(query)
        .populate('client', 'name email')
        .populate('provider', 'name email')
        .populate('service', 'name category');
      filename = `bookings_export_${Date.now()}`;
      break;
    case 'payments':
      data = await Payment.find(query)
        .populate('user', 'name email')
        .populate('booking', 'bookingId');
      filename = `payments_export_${Date.now()}`;
      break;
    case 'reviews':
      data = await Review.find(query)
        .populate('client', 'name')
        .populate('provider', 'name')
        .populate('service', 'name');
      filename = `reviews_export_${Date.now()}`;
      break;
    default:
      return res.status(400).json({
        success: false,
        message: 'Invalid export type'
      });
  }

  if (format === 'csv') {
    // Convert to CSV format
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    // CSV conversion logic would go here
    res.send('CSV export not implemented yet');
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    res.json({
      success: true,
      exportDate: new Date(),
      type,
      count: data.length,
      data
    });
  }
}));

module.exports = router;

