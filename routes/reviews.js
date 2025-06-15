const express = require('express');
const { body, query, validationResult } = require('express-validator');
const Review = require('../models/Review');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Service = require('../models/Service');
const { authenticateUser, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// @desc    Create review
// @route   POST /api/reviews
// @access  Private (Client only)
router.post('/', authenticateUser, [
  body('booking').isMongoId(),
  body('rating.overall').isInt({ min: 1, max: 5 }),
  body('rating.quality').optional().isInt({ min: 1, max: 5 }),
  body('rating.punctuality').optional().isInt({ min: 1, max: 5 }),
  body('rating.communication').optional().isInt({ min: 1, max: 5 }),
  body('rating.value').optional().isInt({ min: 1, max: 5 }),
  body('comment').optional().trim().isLength({ max: 1000 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  if (req.user.role !== 'client') {
    return res.status(403).json({
      success: false,
      message: 'Only clients can create reviews'
    });
  }

  const { booking: bookingId, rating, comment, photos } = req.body;

  // Check if booking exists and belongs to client
  const booking = await Booking.findOne({
    _id: bookingId,
    client: req.user._id,
    status: 'completed',
    'confirmation.clientConfirmed': true
  });

  if (!booking) {
    return res.status(404).json({
      success: false,
      message: 'Booking not found or not eligible for review'
    });
  }

  // Check if review already exists
  const existingReview = await Review.findOne({ booking: bookingId });
  if (existingReview) {
    return res.status(400).json({
      success: false,
      message: 'Review already exists for this booking'
    });
  }

  // Create review
  const review = await Review.create({
    booking: bookingId,
    client: req.user._id,
    provider: booking.provider,
    service: booking.service,
    rating,
    comment,
    photos: photos || []
  });

  // Update provider rating
  const provider = await User.findById(booking.provider);
  provider.updateProviderRating(rating.overall);
  await provider.save();

  // Update service rating
  const service = await Service.findById(booking.service);
  service.updateRating(rating.overall);
  await service.save();

  // Update booking with review reference
  booking.review = review._id;
  await booking.save();

  // Populate review for response
  await review.populate([
    { path: 'client', select: 'name avatar' },
    { path: 'provider', select: 'name providerInfo.businessName' },
    { path: 'service', select: 'name category' }
  ]);

  res.status(201).json({
    success: true,
    message: 'Review created successfully',
    data: {
      review
    }
  });
}));

// @desc    Get reviews
// @route   GET /api/reviews
// @access  Public
router.get('/', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('provider').optional().isMongoId(),
  query('service').optional().isMongoId(),
  query('rating').optional().isInt({ min: 1, max: 5 }),
  query('sortBy').optional().isIn(['newest', 'oldest', 'rating_high', 'rating_low', 'helpful'])
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
  const { provider, service, rating, sortBy } = req.query;

  // Build query
  let query = {
    isVisible: true
  };

  if (provider) {
    query.provider = provider;
  }

  if (service) {
    query.service = service;
  }

  if (rating) {
    query['rating.overall'] = parseInt(rating);
  }

  // Build sort
  let sort = {};
  switch (sortBy) {
    case 'oldest':
      sort = { createdAt: 1 };
      break;
    case 'rating_high':
      sort = { 'rating.overall': -1, createdAt: -1 };
      break;
    case 'rating_low':
      sort = { 'rating.overall': 1, createdAt: -1 };
      break;
    case 'helpful':
      sort = { 'helpful.count': -1, createdAt: -1 };
      break;
    case 'newest':
    default:
      sort = { createdAt: -1 };
      break;
  }

  const reviews = await Review.find(query)
    .populate('client', 'name avatar')
    .populate('provider', 'name providerInfo.businessName')
    .populate('service', 'name category')
    .sort(sort)
    .skip(skip)
    .limit(limit);

  const total = await Review.countDocuments(query);

  res.json({
    success: true,
    data: {
      reviews,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
}));

// @desc    Get review by ID
// @route   GET /api/reviews/:id
// @access  Public
router.get('/:id', asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id)
    .populate('client', 'name avatar')
    .populate('provider', 'name providerInfo.businessName')
    .populate('service', 'name category')
    .populate('booking', 'bookingId scheduledDate');

  if (!review || !review.isVisible) {
    return res.status(404).json({
      success: false,
      message: 'Review not found'
    });
  }

  res.json({
    success: true,
    data: {
      review
    }
  });
}));

// @desc    Respond to review (Provider only)
// @route   PUT /api/reviews/:id/respond
// @access  Private (Provider only)
router.put('/:id/respond', authenticateUser, [
  body('comment').notEmpty().trim().isLength({ max: 500 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const review = await Review.findById(req.params.id);

  if (!review) {
    return res.status(404).json({
      success: false,
      message: 'Review not found'
    });
  }

  // Check if user is the provider of this review
  if (review.provider.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      success: false,
      message: 'You can only respond to reviews for your services'
    });
  }

  if (review.providerResponse.comment) {
    return res.status(400).json({
      success: false,
      message: 'You have already responded to this review'
    });
  }

  const { comment } = req.body;

  review.providerResponse = {
    comment,
    respondedAt: new Date()
  };

  await review.save();

  res.json({
    success: true,
    message: 'Response added successfully',
    data: {
      review
    }
  });
}));

// @desc    Mark review as helpful
// @route   PUT /api/reviews/:id/helpful
// @access  Private
router.put('/:id/helpful', authenticateUser, asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);

  if (!review || !review.isVisible) {
    return res.status(404).json({
      success: false,
      message: 'Review not found'
    });
  }

  // Check if user already marked as helpful
  if (review.helpful.users.includes(req.user._id)) {
    return res.status(400).json({
      success: false,
      message: 'You have already marked this review as helpful'
    });
  }

  review.markHelpful(req.user._id);
  await review.save();

  res.json({
    success: true,
    message: 'Review marked as helpful',
    data: {
      helpfulCount: review.helpful.count
    }
  });
}));

// @desc    Unmark review as helpful
// @route   DELETE /api/reviews/:id/helpful
// @access  Private
router.delete('/:id/helpful', authenticateUser, asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);

  if (!review || !review.isVisible) {
    return res.status(404).json({
      success: false,
      message: 'Review not found'
    });
  }

  review.unmarkHelpful(req.user._id);
  await review.save();

  res.json({
    success: true,
    message: 'Review unmarked as helpful',
    data: {
      helpfulCount: review.helpful.count
    }
  });
}));

// @desc    Flag review
// @route   PUT /api/reviews/:id/flag
// @access  Private
router.put('/:id/flag', authenticateUser, [
  body('reason').notEmpty().trim()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Flag reason is required',
      errors: errors.array()
    });
  }

  const review = await Review.findById(req.params.id);

  if (!review || !review.isVisible) {
    return res.status(404).json({
      success: false,
      message: 'Review not found'
    });
  }

  const { reason } = req.body;

  // Check if user already flagged this review
  const existingFlag = review.flaggedBy.find(
    flag => flag.user.toString() === req.user._id.toString()
  );

  if (existingFlag) {
    return res.status(400).json({
      success: false,
      message: 'You have already flagged this review'
    });
  }

  review.flagReview(req.user._id, reason);
  await review.save();

  res.json({
    success: true,
    message: 'Review flagged successfully. Admin will review.'
  });
}));

// @desc    Get provider rating statistics
// @route   GET /api/reviews/provider/:providerId/stats
// @access  Public
router.get('/provider/:providerId/stats', asyncHandler(async (req, res) => {
  const { providerId } = req.params;

  // Check if provider exists
  const provider = await User.findOne({ _id: providerId, role: 'provider' });
  if (!provider) {
    return res.status(404).json({
      success: false,
      message: 'Provider not found'
    });
  }

  // Get rating statistics
  const averageRating = await Review.getProviderAverageRating(providerId);
  const ratingDistribution = await Review.getProviderRatingDistribution(providerId);

  // Get recent reviews
  const recentReviews = await Review.find({
    provider: providerId,
    isVisible: true
  })
  .populate('client', 'name avatar')
  .populate('service', 'name category')
  .sort({ createdAt: -1 })
  .limit(5);

  res.json({
    success: true,
    data: {
      averageRating: averageRating.averageRating,
      totalReviews: averageRating.totalReviews,
      ratingBreakdown: {
        quality: averageRating.qualityAvg,
        punctuality: averageRating.punctualityAvg,
        communication: averageRating.communicationAvg,
        value: averageRating.valueAvg
      },
      ratingDistribution,
      recentReviews
    }
  });
}));

// @desc    Moderate review (Admin only)
// @route   PUT /api/reviews/:id/moderate
// @access  Private (Admin only)
router.put('/:id/moderate', authenticateUser, requireRole('admin'), [
  body('action').isIn(['approve', 'hide', 'delete']),
  body('notes').optional().trim()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const review = await Review.findById(req.params.id);

  if (!review) {
    return res.status(404).json({
      success: false,
      message: 'Review not found'
    });
  }

  const { action, notes } = req.body;

  switch (action) {
    case 'approve':
      review.isVisible = true;
      review.isFlagged = false;
      break;
    case 'hide':
      review.isVisible = false;
      break;
    case 'delete':
      review.isVisible = false;
      review.isFlagged = true;
      break;
  }

  review.moderatedBy = req.user._id;
  review.moderatedAt = new Date();
  review.moderationNotes = notes;

  await review.save();

  res.json({
    success: true,
    message: `Review ${action}d successfully`,
    data: {
      review
    }
  });
}));

// @desc    Get flagged reviews (Admin only)
// @route   GET /api/reviews/flagged
// @access  Private (Admin only)
router.get('/admin/flagged', authenticateUser, requireRole('admin'), [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const reviews = await Review.find({ isFlagged: true })
    .populate('client', 'name avatar')
    .populate('provider', 'name providerInfo.businessName')
    .populate('service', 'name category')
    .populate('flaggedBy.user', 'name')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await Review.countDocuments({ isFlagged: true });

  res.json({
    success: true,
    data: {
      reviews,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
}));

module.exports = router;

