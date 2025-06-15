const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // Basic Information
  firebaseUid: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  phone: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  avatar: {
    type: String,
    default: null
  },
  
  // Role Management
  role: {
    type: String,
    enum: ['client', 'provider', 'admin'],
    default: 'client'
  },
  
  // Location
  location: {
    address: String,
    city: String,
    governorate: String,
    coordinates: {
      lat: Number,
      lng: Number
    }
  },
  
  // Provider-specific fields
  providerInfo: {
    businessName: String,
    description: String,
    services: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service'
    }],
    experience: Number, // years
    certifications: [String],
    workingHours: {
      start: String,
      end: String,
      days: [String] // ['monday', 'tuesday', etc.]
    },
    serviceRadius: Number, // km
    isActivated: {
      type: Boolean,
      default: false
    },
    activationFeePaid: {
      type: Boolean,
      default: false
    },
    activationFeePaymentId: String,
    activationDate: Date,
    rating: {
      average: {
        type: Number,
        default: 0
      },
      count: {
        type: Number,
        default: 0
      }
    },
    wallet: {
      balance: {
        type: Number,
        default: 0
      },
      pendingBalance: {
        type: Number,
        default: 0
      },
      totalEarnings: {
        type: Number,
        default: 0
      }
    },
    subscriptionPlan: {
      type: String,
      enum: ['basic', 'premium'],
      default: 'basic'
    },
    subscriptionExpiry: Date,
    featured: {
      type: Boolean,
      default: false
    }
  },
  
  // Client-specific fields
  clientInfo: {
    bookingHistory: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking'
    }],
    favoriteProviders: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  
  // Notification preferences
  notifications: {
    email: {
      type: Boolean,
      default: true
    },
    push: {
      type: Boolean,
      default: true
    },
    sms: {
      type: Boolean,
      default: false
    }
  },
  
  // Language preference
  language: {
    type: String,
    enum: ['ar', 'en'],
    default: 'ar'
  },
  
  // Account status
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationCode: String,
  
  // FCM token for push notifications
  fcmToken: String,
  
  // Timestamps
  lastLogin: Date,
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
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Method to check if provider is activated
userSchema.methods.isProviderActivated = function() {
  return this.role === 'provider' && 
         this.providerInfo.isActivated && 
         this.providerInfo.activationFeePaid;
};

// Method to calculate provider rating
userSchema.methods.updateProviderRating = function(newRating) {
  if (this.role === 'provider') {
    const currentTotal = this.providerInfo.rating.average * this.providerInfo.rating.count;
    this.providerInfo.rating.count += 1;
    this.providerInfo.rating.average = (currentTotal + newRating) / this.providerInfo.rating.count;
  }
};

// Method to add earnings to provider wallet
userSchema.methods.addEarnings = function(amount) {
  if (this.role === 'provider') {
    this.providerInfo.wallet.balance += amount;
    this.providerInfo.wallet.totalEarnings += amount;
  }
};

// Method to add pending earnings
userSchema.methods.addPendingEarnings = function(amount) {
  if (this.role === 'provider') {
    this.providerInfo.wallet.pendingBalance += amount;
  }
};

// Method to transfer pending to available balance
userSchema.methods.confirmEarnings = function(amount) {
  if (this.role === 'provider') {
    this.providerInfo.wallet.pendingBalance -= amount;
    this.providerInfo.wallet.balance += amount;
  }
};

module.exports = mongoose.model('User', userSchema);

