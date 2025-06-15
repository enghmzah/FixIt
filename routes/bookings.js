const express = require('express');
const { body, query, validationResult } = require('express-validator');
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const User = require('../models/User');
const { authenticateUser, requireBookingAccess } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Middleware to load booking and check access
const loadBooking = asyncHandler(async (req, res, next) => {
  const booking = await Booking.findById(req.params.id)
    .populate('client', 'name avatar phone')
    .populate('provider', 'name avatar phone providerInfo.businessName')
    .populate('service', 'name category');

  if (!booking) {
    return res.status(404).json({
      success: false,
      message: 'Booking not found'
    });
  }

  req.booking = booking;
  next();
});

// @desc    Create new booking
// @route   POST /api/bookings
// @access  Private (Client only)
router.post('/', authenticateUser, [
  body('service').isMongoId(),
  body('scheduledDate').isISO8601(),
  body('scheduledTime.start').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('location.address').notEmpty().trim(),
  body('location.city').notEmpty().trim(),
  body('location.governorate').notEmpty().trim(),
  body('paymentMethod').isIn(['vodafone_cash', 'etisalat_cash', 'orange_money', 'we_pay', 'stripe', 'paypal'])
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
      message: 'Only clients can create bookings'
    });
  }

  const {
    service: serviceId,
    scheduledDate,
    scheduledTime,
    location,
    serviceDetails,
    paymentMethod
  } = req.body;

  // Get service and provider
  const service = await Service.findById(serviceId).populate('provider');
  if (!service || !service.isActive || !service.isApproved) {
    return res.status(404).json({
      success: false,
      message: 'Service not found or not available'
    });
  }

  // Check if provider is activated
  if (!service.provider.isProviderActivated()) {
    return res.status(400).json({
      success: false,
      message: 'Provider is not activated'
    });
  }

  // Calculate pricing
  const servicePrice = service.pricing.amount;
  const addOnsPrice = serviceDetails?.addOns?.reduce((total, addon) => total + addon.price, 0) || 0;
  const platformFee = parseInt(process.env.PLATFORM_FEE) || 5;
  const totalAmount = servicePrice + addOnsPrice + platformFee;

  // Create booking
  const booking = await Booking.create({
    client: req.user._id,
    provider: service.provider._id,
    service: serviceId,
    scheduledDate: new Date(scheduledDate),
    scheduledTime,
    location,
    serviceDetails,
    pricing: {
      servicePrice,
      addOnsPrice,
      platformFee,
      totalAmount
    },
    payment: {
      method: paymentMethod
    }
  });

  // Update service statistics
  service.incrementBooking();
  await service.save();

  // Populate booking for response
  await booking.populate([
    { path: 'client', select: 'name avatar phone' },
    { path: 'provider', select: 'name avatar phone providerInfo.businessName' },
    { path: 'service', select: 'name category' }
  ]);

  res.status(201).json({
    success: true,
    message: 'Booking created successfully',
    data: {
      booking
    }
  });
}));

// @desc    Get user's bookings
// @route   GET /api/bookings
// @access  Private
router.get('/', authenticateUser, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('status').optional().isIn(['pending', 'accepted', 'rejected', 'in_progress', 'completed', 'cancelled', 'disputed'])
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
  const { status } = req.query;

  // Build query based on user role
  let query = {};
  if (req.user.role === 'client') {
    query.client = req.user._id;
  } else if (req.user.role === 'provider') {
    query.provider = req.user._id;
  } else if (req.user.role === 'admin') {
    // Admin can see all bookings
  }

  if (status) {
    query.status = status;
  }

  const bookings = await Booking.find(query)
    .populate('client', 'name avatar phone')
    .populate('provider', 'name avatar phone providerInfo.businessName')
    .populate('service', 'name category')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await Booking.countDocuments(query);

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

// @desc    Get booking by ID
// @route   GET /api/bookings/:id
// @access  Private
router.get('/:id', authenticateUser, loadBooking, requireBookingAccess, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      booking: req.booking
    }
  });
}));

// @desc    Accept booking (Provider only)
// @route   PUT /api/bookings/:id/accept
// @access  Private (Provider only)
router.put('/:id/accept', authenticateUser, loadBooking, requireBookingAccess, [
  body('message').optional().trim(),
  body('suggestedTime').optional().isObject()
], asyncHandler(async (req, res) => {
  const booking = req.booking;
  const { message, suggestedTime } = req.body;

  if (req.userBookingRole !== 'provider') {
    return res.status(403).json({
      success: false,
      message: 'Only providers can accept bookings'
    });
  }

  if (booking.status !== 'pending') {
    return res.status(400).json({
      success: false,
      message: 'Booking cannot be accepted in current status'
    });
  }

  // Update booking status
  booking.updateStatus('accepted', req.user._id, 'Provider accepted the booking');
  booking.providerResponse = {
    accepted: true,
    respondedAt: new Date(),
    message,
    suggestedTime
  };

  await booking.save();

  res.json({
    success: true,
    message: 'Booking accepted successfully',
    data: {
      booking
    }
  });
}));

// @desc    Reject booking (Provider only)
// @route   PUT /api/bookings/:id/reject
// @access  Private (Provider only)
router.put('/:id/reject', authenticateUser, loadBooking, requireBookingAccess, [
  body('reason').notEmpty().trim()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Rejection reason is required',
      errors: errors.array()
    });
  }

  const booking = req.booking;
  const { reason } = req.body;

  if (req.userBookingRole !== 'provider') {
    return res.status(403).json({
      success: false,
      message: 'Only providers can reject bookings'
    });
  }

  if (booking.status !== 'pending') {
    return res.status(400).json({
      success: false,
      message: 'Booking cannot be rejected in current status'
    });
  }

  // Update booking status
  booking.updateStatus('rejected', req.user._id, reason);
  booking.providerResponse = {
    accepted: false,
    respondedAt: new Date(),
    message: reason
  };

  await booking.save();

  res.json({
    success: true,
    message: 'Booking rejected',
    data: {
      booking
    }
  });
}));

// @desc    Start service (Provider only)
// @route   PUT /api/bookings/:id/start
// @access  Private (Provider only)
router.put('/:id/start', authenticateUser, loadBooking, requireBookingAccess, asyncHandler(async (req, res) => {
  const booking = req.booking;

  if (req.userBookingRole !== 'provider') {
    return res.status(403).json({
      success: false,
      message: 'Only providers can start service'
    });
  }

  if (booking.status !== 'accepted') {
    return res.status(400).json({
      success: false,
      message: 'Service can only be started for accepted bookings'
    });
  }

  // Update booking status
  booking.updateStatus('in_progress', req.user._id, 'Service started');
  booking.execution.startedAt = new Date();

  await booking.save();

  res.json({
    success: true,
    message: 'Service started successfully',
    data: {
      booking
    }
  });
}));

// @desc    Complete service (Provider only)
// @route   PUT /api/bookings/:id/complete
// @access  Private (Provider only)
router.put('/:id/complete', authenticateUser, loadBooking, requireBookingAccess, [
  body('completionNotes').optional().trim(),
  body('workPhotos').optional().isArray()
], asyncHandler(async (req, res) => {
  const booking = req.booking;
  const { completionNotes, workPhotos } = req.body;

  if (req.userBookingRole !== 'provider') {
    return res.status(403).json({
      success: false,
      message: 'Only providers can complete service'
    });
  }

  if (booking.status !== 'in_progress') {
    return res.status(400).json({
      success: false,
      message: 'Service can only be completed for in-progress bookings'
    });
  }

  // Calculate actual duration
  const startTime = booking.execution.startedAt;
  const endTime = new Date();
  const actualDuration = Math.round((endTime - startTime) / (1000 * 60)); // in minutes

  // Update booking
  booking.updateStatus('completed', req.user._id, 'Service completed');
  booking.execution.completedAt = endTime;
  booking.execution.actualDuration = actualDuration;
  booking.execution.completionNotes = completionNotes;
  booking.execution.workPhotos = workPhotos || [];

  // Add pending earnings to provider
  const provider = await User.findById(booking.provider._id);
  provider.addPendingEarnings(booking.pricing.servicePrice + booking.pricing.addOnsPrice);
  await provider.save();

  // Update service statistics
  const service = await Service.findById(booking.service._id);
  service.incrementCompleted();
  await service.save();

  await booking.save();

  res.json({
    success: true,
    message: 'Service completed successfully. Awaiting client confirmation.',
    data: {
      booking
    }
  });
}));

// @desc    Confirm service completion (Client only)
// @route   PUT /api/bookings/:id/confirm
// @access  Private (Client only)
router.put('/:id/confirm', authenticateUser, loadBooking, requireBookingAccess, asyncHandler(async (req, res) => {
  const booking = req.booking;

  if (req.userBookingRole !== 'client') {
    return res.status(403).json({
      success: false,
      message: 'Only clients can confirm service completion'
    });
  }

  if (booking.status !== 'completed') {
    return res.status(400).json({
      success: false,
      message: 'Only completed services can be confirmed'
    });
  }

  if (booking.confirmation.clientConfirmed) {
    return res.status(400).json({
      success: false,
      message: 'Service already confirmed'
    });
  }

  // Confirm booking
  booking.confirmation.clientConfirmed = true;
  booking.confirmation.confirmedAt = new Date();
  booking.confirmation.confirmationMethod = 'manual';

  // Transfer earnings from pending to available
  const provider = await User.findById(booking.provider._id);
  const earningsAmount = booking.pricing.servicePrice + booking.pricing.addOnsPrice;
  provider.confirmEarnings(earningsAmount);
  await provider.save();

  // Update payment status
  booking.payment.status = 'completed';
  booking.payment.paidAt = new Date();

  await booking.save();

  res.json({
    success: true,
    message: 'Service confirmed successfully. Payment processed.',
    data: {
      booking
    }
  });
}));

// @desc    Cancel booking
// @route   PUT /api/bookings/:id/cancel
// @access  Private
router.put('/:id/cancel', authenticateUser, loadBooking, requireBookingAccess, [
  body('reason').notEmpty().trim()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Cancellation reason is required',
      errors: errors.array()
    });
  }

  const booking = req.booking;
  const { reason } = req.body;

  if (!booking.canBeCancelled()) {
    return res.status(400).json({
      success: false,
      message: 'Booking cannot be cancelled at this time'
    });
  }

  // Update booking status
  booking.updateStatus('cancelled', req.user._id, reason);
  booking.cancellation = {
    cancelledBy: req.user._id,
    cancelledAt: new Date(),
    reason
  };

  await booking.save();

  res.json({
    success: true,
    message: 'Booking cancelled successfully',
    data: {
      booking
    }
  });
}));

// @desc    Dispute booking
// @route   PUT /api/bookings/:id/dispute
// @access  Private
router.put('/:id/dispute', authenticateUser, loadBooking, requireBookingAccess, [
  body('reason').notEmpty().trim(),
  body('description').notEmpty().trim()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const booking = req.booking;
  const { reason, description, evidence } = req.body;

  if (!['completed', 'in_progress'].includes(booking.status)) {
    return res.status(400).json({
      success: false,
      message: 'Only completed or in-progress bookings can be disputed'
    });
  }

  if (booking.dispute.isDisputed) {
    return res.status(400).json({
      success: false,
      message: 'Booking is already disputed'
    });
  }

  // Create dispute
  booking.updateStatus('disputed', req.user._id, reason);
  booking.dispute = {
    isDisputed: true,
    disputedBy: req.user._id,
    disputedAt: new Date(),
    reason,
    description,
    evidence: evidence || []
  };

  await booking.save();

  res.json({
    success: true,
    message: 'Dispute created successfully. Admin will review.',
    data: {
      booking
    }
  });
}));

// @desc    Get booking statistics
// @route   GET /api/bookings/stats
// @access  Private
router.get('/stats/overview', authenticateUser, asyncHandler(async (req, res) => {
  let query = {};
  
  if (req.user.role === 'client') {
    query.client = req.user._id;
  } else if (req.user.role === 'provider') {
    query.provider = req.user._id;
  }

  const stats = await Booking.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$pricing.totalAmount' }
      }
    }
  ]);

  const totalBookings = await Booking.countDocuments(query);
  const thisMonthBookings = await Booking.countDocuments({
    ...query,
    createdAt: {
      $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    }
  });

  res.json({
    success: true,
    data: {
      totalBookings,
      thisMonthBookings,
      statusBreakdown: stats
    }
  });
}));

module.exports = router;

