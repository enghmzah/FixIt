const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  // Conversation Information
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true
  },
  
  // Message Details
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Message Content
  content: {
    type: String,
    required: true,
    maxlength: 1000
  },
  
  // Message Type
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'location', 'system'],
    default: 'text'
  },
  
  // Attachments
  attachments: [{
    type: {
      type: String,
      enum: ['image', 'file', 'location']
    },
    url: String,
    filename: String,
    size: Number, // in bytes
    mimeType: String,
    coordinates: {
      lat: Number,
      lng: Number
    }
  }],
  
  // Message Status
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  
  // Read Status
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // System Message Details (for automated messages)
  systemMessage: {
    action: {
      type: String,
      enum: ['booking_created', 'booking_accepted', 'booking_rejected', 'booking_completed', 'payment_processed']
    },
    data: mongoose.Schema.Types.Mixed
  },
  
  // Message Metadata
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: Date,
  originalContent: String,
  
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Reply Information
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
messageSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Method to mark message as read
messageSchema.methods.markAsRead = function(userId) {
  const existingRead = this.readBy.find(read => read.user.toString() === userId.toString());
  if (!existingRead) {
    this.readBy.push({ user: userId });
    if (this.status === 'delivered') {
      this.status = 'read';
    }
  }
};

// Method to edit message
messageSchema.methods.editMessage = function(newContent) {
  this.originalContent = this.content;
  this.content = newContent;
  this.isEdited = true;
  this.editedAt = new Date();
};

// Method to delete message
messageSchema.methods.deleteMessage = function(userId) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
};

// Static method to get conversation messages
messageSchema.statics.getConversation = async function(bookingId, page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  
  return await this.find({
    booking: bookingId,
    isDeleted: false
  })
  .populate('sender', 'name avatar')
  .populate('receiver', 'name avatar')
  .populate('replyTo', 'content sender')
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit);
};

// Static method to get unread message count
messageSchema.statics.getUnreadCount = async function(userId, bookingId) {
  return await this.countDocuments({
    booking: bookingId,
    receiver: userId,
    status: { $in: ['sent', 'delivered'] },
    isDeleted: false
  });
};

// Static method to mark all messages as delivered
messageSchema.statics.markAllAsDelivered = async function(bookingId, userId) {
  return await this.updateMany({
    booking: bookingId,
    receiver: userId,
    status: 'sent'
  }, {
    status: 'delivered'
  });
};

// Static method to get latest message for a booking
messageSchema.statics.getLatestMessage = async function(bookingId) {
  return await this.findOne({
    booking: bookingId,
    isDeleted: false
  })
  .populate('sender', 'name avatar')
  .sort({ createdAt: -1 });
};

// Indexes for performance
messageSchema.index({ booking: 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, status: 1 });
messageSchema.index({ booking: 1, receiver: 1, status: 1 });

module.exports = mongoose.model('Message', messageSchema);

