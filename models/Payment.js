const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  // Payment Identification
  paymentId: {
    type: String,
    unique: true,
    required: true
  },
  
  // Payment Type
  type: {
    type: String,
    enum: ['activation_fee', 'booking_payment', 'subscription', 'withdrawal', 'refund'],
    required: true
  },
  
  // Related Documents
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking'
  },
  
  // Payment Details
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'EGP'
  },
  
  // Payment Method
  method: {
    type: String,
    enum: ['vodafone_cash', 'etisalat_cash', 'orange_money', 'we_pay', 'stripe', 'paypal', 'bank_transfer'],
    required: true
  },
  
  // Payment Status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded'],
    default: 'pending'
  },
  
  // External Payment Information
  externalPaymentId: String, // Payment ID from payment provider
  paymentIntentId: String,   // Stripe payment intent ID
  transactionId: String,     // Transaction ID from mobile payment
  
  // Payment Provider Response
  providerResponse: {
    raw: mongoose.Schema.Types.Mixed,
    status: String,
    message: String,
    errorCode: String
  },
  
  // Payment Breakdown (for booking payments)
  breakdown: {
    serviceAmount: Number,
    addOnsAmount: Number,
    platformFee: Number,
    taxes: Number,
    discount: Number,
    total: Number
  },
  
  // Mobile Payment Details
  mobilePayment: {
    phoneNumber: String,
    operatorReference: String,
    confirmationCode: String
  },
  
  // Card Payment Details (for Stripe/PayPal)
  cardPayment: {
    last4: String,
    brand: String,
    country: String,
    fingerprint: String
  },
  
  // Refund Information
  refund: {
    refundId: String,
    refundAmount: Number,
    reason: String,
    refundedAt: Date,
    refundMethod: String
  },
  
  // Withdrawal Information (for providers)
  withdrawal: {
    bankAccount: {
      accountNumber: String,
      bankName: String,
      accountHolderName: String,
      iban: String
    },
    mobileWallet: {
      phoneNumber: String,
      provider: String
    },
    processingFee: Number,
    netAmount: Number,
    processedAt: Date,
    reference: String
  },
  
  // Payment Metadata
  metadata: {
    ipAddress: String,
    userAgent: String,
    deviceId: String,
    location: {
      country: String,
      city: String
    }
  },
  
  // Timestamps
  initiatedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  failedAt: Date,
  
  // Webhook Information
  webhookReceived: {
    type: Boolean,
    default: false
  },
  webhookData: mongoose.Schema.Types.Mixed,
  
  // Notes and Description
  description: String,
  internalNotes: String,
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Generate unique payment ID
paymentSchema.pre('save', async function(next) {
  if (this.isNew) {
    const prefix = this.type === 'activation_fee' ? 'ACT' : 
                   this.type === 'booking_payment' ? 'BKG' :
                   this.type === 'withdrawal' ? 'WTH' :
                   this.type === 'refund' ? 'REF' : 'PAY';
    
    let isUnique = false;
    while (!isUnique) {
      const candidateId = prefix + Date.now() + 
        Math.random().toString(36).substring(2, 7).toUpperCase();
      
      const exists = await this.constructor.findOne({ paymentId: candidateId });
      if (!exists) {
        this.paymentId = candidateId;
        isUnique = true;
      }
    }
  }
  this.updatedAt = Date.now();
  next();
});

// Method to update payment status
paymentSchema.methods.updateStatus = function(newStatus, providerResponse = null) {
  this.status = newStatus;
  
  if (providerResponse) {
    this.providerResponse = providerResponse;
  }
  
  if (newStatus === 'completed') {
    this.completedAt = new Date();
  } else if (newStatus === 'failed') {
    this.failedAt = new Date();
  }
};

// Method to process refund
paymentSchema.methods.processRefund = function(refundAmount, reason) {
  this.refund = {
    refundAmount: refundAmount,
    reason: reason,
    refundedAt: new Date()
  };
  this.status = 'refunded';
};

// Static method to get payment statistics
paymentSchema.statics.getPaymentStats = async function(startDate, endDate) {
  const matchStage = {
    createdAt: { $gte: startDate, $lte: endDate },
    status: 'completed'
  };
  
  const stats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$type',
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 },
        avgAmount: { $avg: '$amount' }
      }
    }
  ]);
  
  const methodStats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$method',
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ]);
  
  return { typeStats: stats, methodStats: methodStats };
};

// Static method to get user payment history
paymentSchema.statics.getUserPaymentHistory = async function(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  
  return await this.find({ user: userId })
    .populate('booking', 'bookingId service')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

// Static method to calculate platform revenue
paymentSchema.statics.getPlatformRevenue = async function(startDate, endDate) {
  const result = await this.aggregate([
    {
      $match: {
        type: 'booking_payment',
        status: 'completed',
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$breakdown.platformFee' },
        totalTransactions: { $sum: 1 },
        totalVolume: { $sum: '$amount' }
      }
    }
  ]);
  
  return result.length > 0 ? result[0] : {
    totalRevenue: 0,
    totalTransactions: 0,
    totalVolume: 0
  };
};

// Indexes for performance
paymentSchema.index({ user: 1, createdAt: -1 });
paymentSchema.index({ booking: 1 });
paymentSchema.index({ type: 1, status: 1 });
paymentSchema.index({ method: 1 });
paymentSchema.index({ externalPaymentId: 1 });
paymentSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);

