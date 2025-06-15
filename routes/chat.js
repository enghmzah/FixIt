const express = require('express');
const { body, query, validationResult } = require('express-validator');
const Message = require('../models/Message');
const Booking = require('../models/Booking');
const { authenticateUser, requireBookingAccess } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Middleware to load booking and check access
const loadBookingForChat = asyncHandler(async (req, res, next) => {
  const booking = await Booking.findById(req.params.bookingId)
    .populate('client', 'name avatar')
    .populate('provider', 'name avatar');

  if (!booking) {
    return res.status(404).json({
      success: false,
      message: 'Booking not found'
    });
  }

  // Check if user has access to this booking
  const userId = req.user._id.toString();
  const isClient = booking.client._id.toString() === userId;
  const isProvider = booking.provider._id.toString() === userId;
  const isAdmin = req.user.role === 'admin';

  if (!isClient && !isProvider && !isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  req.booking = booking;
  req.userBookingRole = isClient ? 'client' : isProvider ? 'provider' : 'admin';
  next();
});

// @desc    Get conversation messages
// @route   GET /api/chat/:bookingId/messages
// @access  Private
router.get('/:bookingId/messages', authenticateUser, loadBookingForChat, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
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
  const limit = parseInt(req.query.limit) || 50;

  const messages = await Message.getConversation(req.booking._id, page, limit);

  // Mark messages as delivered for the current user
  await Message.markAllAsDelivered(req.booking._id, req.user._id);

  res.json({
    success: true,
    data: {
      messages: messages.reverse(), // Reverse to show oldest first
      booking: {
        id: req.booking._id,
        bookingId: req.booking.bookingId,
        status: req.booking.status,
        client: req.booking.client,
        provider: req.booking.provider
      },
      pagination: {
        page,
        limit,
        hasMore: messages.length === limit
      }
    }
  });
}));

// @desc    Send message
// @route   POST /api/chat/:bookingId/messages
// @access  Private
router.post('/:bookingId/messages', authenticateUser, loadBookingForChat, [
  body('content').notEmpty().trim().isLength({ max: 1000 }),
  body('type').optional().isIn(['text', 'image', 'file', 'location']),
  body('replyTo').optional().isMongoId()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const { content, type = 'text', attachments, replyTo } = req.body;
  const booking = req.booking;

  // Determine receiver
  const senderId = req.user._id;
  let receiverId;

  if (booking.client._id.toString() === senderId.toString()) {
    receiverId = booking.provider._id;
  } else if (booking.provider._id.toString() === senderId.toString()) {
    receiverId = booking.client._id;
  } else {
    return res.status(403).json({
      success: false,
      message: 'Invalid sender for this booking'
    });
  }

  // Create message
  const messageData = {
    booking: booking._id,
    sender: senderId,
    receiver: receiverId,
    content,
    type,
    attachments: attachments || []
  };

  if (replyTo) {
    // Verify reply message exists and belongs to this booking
    const replyMessage = await Message.findOne({
      _id: replyTo,
      booking: booking._id
    });

    if (replyMessage) {
      messageData.replyTo = replyTo;
    }
  }

  const message = await Message.create(messageData);

  // Populate message for response
  await message.populate([
    { path: 'sender', select: 'name avatar' },
    { path: 'receiver', select: 'name avatar' },
    { path: 'replyTo', select: 'content sender' }
  ]);

  res.status(201).json({
    success: true,
    message: 'Message sent successfully',
    data: {
      message
    }
  });
}));

// @desc    Mark messages as read
// @route   PUT /api/chat/:bookingId/read
// @access  Private
router.put('/:bookingId/read', authenticateUser, loadBookingForChat, [
  body('messageIds').isArray().notEmpty()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Message IDs are required',
      errors: errors.array()
    });
  }

  const { messageIds } = req.body;

  // Update messages as read
  await Message.updateMany({
    _id: { $in: messageIds },
    booking: req.booking._id,
    receiver: req.user._id,
    status: { $in: ['sent', 'delivered'] }
  }, {
    status: 'read'
  });

  // Add read receipts
  const messages = await Message.find({
    _id: { $in: messageIds },
    booking: req.booking._id
  });

  for (const message of messages) {
    message.markAsRead(req.user._id);
    await message.save();
  }

  res.json({
    success: true,
    message: 'Messages marked as read'
  });
}));

// @desc    Edit message
// @route   PUT /api/chat/messages/:messageId
// @access  Private
router.put('/messages/:messageId', authenticateUser, [
  body('content').notEmpty().trim().isLength({ max: 1000 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const message = await Message.findById(req.params.messageId);

  if (!message) {
    return res.status(404).json({
      success: false,
      message: 'Message not found'
    });
  }

  // Check if user is the sender
  if (message.sender.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      success: false,
      message: 'You can only edit your own messages'
    });
  }

  // Check if message can be edited (within 15 minutes)
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  if (message.createdAt < fifteenMinutesAgo) {
    return res.status(400).json({
      success: false,
      message: 'Messages can only be edited within 15 minutes of sending'
    });
  }

  const { content } = req.body;

  message.editMessage(content);
  await message.save();

  res.json({
    success: true,
    message: 'Message edited successfully',
    data: {
      message
    }
  });
}));

// @desc    Delete message
// @route   DELETE /api/chat/messages/:messageId
// @access  Private
router.delete('/messages/:messageId', authenticateUser, asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.messageId);

  if (!message) {
    return res.status(404).json({
      success: false,
      message: 'Message not found'
    });
  }

  // Check if user is the sender or admin
  const isSender = message.sender.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isSender && !isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'You can only delete your own messages'
    });
  }

  message.deleteMessage(req.user._id);
  await message.save();

  res.json({
    success: true,
    message: 'Message deleted successfully'
  });
}));

// @desc    Get unread message count
// @route   GET /api/chat/:bookingId/unread-count
// @access  Private
router.get('/:bookingId/unread-count', authenticateUser, loadBookingForChat, asyncHandler(async (req, res) => {
  const unreadCount = await Message.getUnreadCount(req.user._id, req.booking._id);

  res.json({
    success: true,
    data: {
      unreadCount
    }
  });
}));

// @desc    Get user's conversations
// @route   GET /api/chat/conversations
// @access  Private
router.get('/conversations', authenticateUser, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  // Get user's bookings that have messages
  let bookingQuery = {};
  if (req.user.role === 'client') {
    bookingQuery.client = req.user._id;
  } else if (req.user.role === 'provider') {
    bookingQuery.provider = req.user._id;
  }

  const bookings = await Booking.find(bookingQuery)
    .populate('client', 'name avatar')
    .populate('provider', 'name avatar providerInfo.businessName')
    .populate('service', 'name category')
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit);

  // Get latest message and unread count for each booking
  const conversations = await Promise.all(
    bookings.map(async (booking) => {
      const latestMessage = await Message.getLatestMessage(booking._id);
      const unreadCount = await Message.getUnreadCount(req.user._id, booking._id);

      return {
        booking: {
          id: booking._id,
          bookingId: booking.bookingId,
          status: booking.status,
          client: booking.client,
          provider: booking.provider,
          service: booking.service,
          scheduledDate: booking.scheduledDate
        },
        latestMessage,
        unreadCount
      };
    })
  );

  const total = await Booking.countDocuments(bookingQuery);

  res.json({
    success: true,
    data: {
      conversations,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
}));

// @desc    Send system message
// @route   POST /api/chat/:bookingId/system-message
// @access  Private (Internal use)
router.post('/:bookingId/system-message', authenticateUser, loadBookingForChat, [
  body('action').isIn(['booking_created', 'booking_accepted', 'booking_rejected', 'booking_completed', 'payment_processed']),
  body('data').optional().isObject()
], asyncHandler(async (req, res) => {
  const { action, data } = req.body;
  const booking = req.booking;

  // Generate system message content based on action
  let content;
  switch (action) {
    case 'booking_created':
      content = 'Booking has been created and is awaiting provider response.';
      break;
    case 'booking_accepted':
      content = 'Booking has been accepted by the provider.';
      break;
    case 'booking_rejected':
      content = 'Booking has been rejected by the provider.';
      break;
    case 'booking_completed':
      content = 'Service has been completed. Please confirm to process payment.';
      break;
    case 'payment_processed':
      content = 'Payment has been processed successfully.';
      break;
    default:
      content = 'Booking status updated.';
  }

  // Create system message
  const message = await Message.create({
    booking: booking._id,
    sender: req.user._id,
    receiver: booking.client._id.toString() === req.user._id.toString() ? booking.provider._id : booking.client._id,
    content,
    type: 'system',
    systemMessage: {
      action,
      data: data || {}
    }
  });

  res.status(201).json({
    success: true,
    message: 'System message sent',
    data: {
      message
    }
  });
}));

module.exports = router;

