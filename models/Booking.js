const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  // Basic Information
  bookingId: {
    type: String,
    unique: true,
    required: true
  },
  
  // Parties involved
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  provider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  service: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: true
  },
  
  // Booking Details
  scheduledDate: {
    type: Date,
    required: true
  },
  scheduledTime: {
    start: {
      type: String,
      required: true
    },
    end: String
  },
  
  // Location
  location: {
    address: {
      type: String,
      required: true
    },
    city: {
      type: String,
      required: true
    },
    governorate: {
      type: String,
      required: true
    },
    coordinates: {
      lat: Number,
      lng: Number
    },
    additionalInfo: String // apartment number, floor, etc.
  },
  
  // Service Details
  serviceDetails: {
    description: String,
    requirements: [String],
    addOns: [{
      name: String,
      price: Number
    }],
    estimatedDuration: Number, // minutes
    specialInstructions: String
  },
  
  // Pricing
  pricing: {
    servicePrice: {
      type: Number,
      required: true
    },
    addOnsPrice: {
      type: Number,
      default: 0
    },
    platformFee: {
      type: Number,
      required: true
    },
    totalAmount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: 'EGP'
    }
  },
  
  // Status Management
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'in_progress', 'completed', 'cancelled', 'disputed'],
    default: 'pending'
  },
  
  // Status History
  statusHistory: [{
    status: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: String
  }],
  
  // Provider Response
  providerResponse: {
    accepted: Boolean,
    respondedAt: Date,
    message: String,
    suggestedTime: {
      date: Date,
      start: String,
      end: String
    }
  },
  
  // Service Execution
  execution: {
    startedAt: Date,
    completedAt: Date,
    actualDuration: Number, // minutes
    workPhotos: [String], // URLs to photos taken during work
    completionNotes: String
  },
  
  // Payment Information
  payment: {
    method: {
      type: String,
      enum: ['vodafone_cash', 'etisalat_cash', 'orange_money', 'we_pay', 'stripe', 'paypal'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    transactionId: String,
    paidAt: Date,
    paymentIntentId: String, // for Stripe
    refundId: String,
    refundedAt: Date
  },
  
  // Confirmation System
  confirmation: {
    clientConfirmed: {
      type: Boolean,
      default: false
    },
    confirmedAt: Date,
    autoConfirmAt: Date, // 48 hours after completion
    confirmationMethod: {
      type: String,
      enum: ['manual', 'auto']
    }
  },
  
  // Dispute Management
  dispute: {
    isDisputed: {
      type: Boolean,
      default: false
    },
    disputedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    disputedAt: Date,
    reason: String,
    description: String,
    evidence: [String], // URLs to evidence files
    resolution: {
      resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      resolvedAt: Date,
      resolution: String,
      refundAmount: Number
    }
  },
  
  // Communication
  messages: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  }],
  
  // Review and Rating
  review: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Review'
  },
  
  // Cancellation
  cancellation: {
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    cancelledAt: Date,
    reason: String,
    refundAmount: Number,
    cancellationFee: Number
  },
  
  // Notifications sent
  notificationsSent: {
    bookingCreated: Boolean,
    providerNotified: Boolean,
    clientNotified: Boolean,
    reminderSent: Boolean,
    completionNotified: Boolean,
    paymentProcessed: Boolean
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

// Generate unique booking ID
bookingSchema.pre('save', function(next) {
  if (this.isNew) {
    this.bookingId = 'SLH' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
    
    // Set auto-confirmation date if completed
    if (this.status === 'completed' && !this.confirmation.autoConfirmAt) {
      this.confirmation.autoConfirmAt = new Date(Date.now() + (48 * 60 * 60 * 1000)); // 48 hours
    }
  }
  
  this.updatedAt = Date.now();
  next();
});

// Method to update status with history
bookingSchema.methods.updateStatus = function(newStatus, updatedBy, reason) {
  this.statusHistory.push({
    status: this.status,
    updatedBy: updatedBy,
    reason: reason
  });
  this.status = newStatus;
  
  // Set completion time if status is completed
  if (newStatus === 'completed') {
    this.execution.completedAt = new Date();
    this.confirmation.autoConfirmAt = new Date(Date.now() + (48 * 60 * 60 * 1000));
  }
};

// Method to calculate total amount
bookingSchema.methods.calculateTotal = function() {
  const servicePrice = this.pricing.servicePrice || 0;
  const addOnsPrice = this.pricing.addOnsPrice || 0;
  const platformFee = process.env.PLATFORM_FEE || 5;
  
  this.pricing.platformFee = platformFee;
  this.pricing.totalAmount = servicePrice + addOnsPrice + platformFee;
  
  return this.pricing.totalAmount;
};

// Method to check if booking can be cancelled
bookingSchema.methods.canBeCancelled = function() {
  const now = new Date();
  const scheduledDateTime = new Date(this.scheduledDate);
  const hoursDifference = (scheduledDateTime - now) / (1000 * 60 * 60);
  
  return ['pending', 'accepted'].includes(this.status) && hoursDifference > 2;
};

// Method to check if auto-confirmation should happen
bookingSchema.methods.shouldAutoConfirm = function() {
  return this.status === 'completed' && 
         !this.confirmation.clientConfirmed && 
         new Date() >= this.confirmation.autoConfirmAt;
};

// Indexes for performance
bookingSchema.index({ client: 1, createdAt: -1 });
bookingSchema.index({ provider: 1, createdAt: -1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ scheduledDate: 1 });
bookingSchema.index({ bookingId: 1 });
bookingSchema.index({ 'confirmation.autoConfirmAt': 1 });

module.exports = mongoose.model('Booking', bookingSchema);

