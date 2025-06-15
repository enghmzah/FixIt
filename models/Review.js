const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  // Basic Information
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true,
    unique: true
  },
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
  
  // Rating (1-5 stars)
  rating: {
    overall: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    quality: {
      type: Number,
      min: 1,
      max: 5
    },
    punctuality: {
      type: Number,
      min: 1,
      max: 5
    },
    communication: {
      type: Number,
      min: 1,
      max: 5
    },
    value: {
      type: Number,
      min: 1,
      max: 5
    }
  },
  
  // Review Text
  comment: {
    type: String,
    maxlength: 1000
  },
  
  // Review Photos
  photos: [String], // URLs to review photos
  
  // Provider Response
  providerResponse: {
    comment: {
      type: String,
      maxlength: 500
    },
    respondedAt: Date
  },
  
  // Review Status
  isVisible: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: true
  },
  
  // Moderation
  isFlagged: {
    type: Boolean,
    default: false
  },
  flaggedBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: String,
    flaggedAt: {
      type: Date,
      default: Date.now
    }
  }],
  moderatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  moderatedAt: Date,
  moderationNotes: String,
  
  // Helpfulness
  helpful: {
    count: {
      type: Number,
      default: 0
    },
    users: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  }
}, { 
  // Enable automatic timestamps
  timestamps: true 
});

// Method to mark review as helpful
reviewSchema.methods.markHelpful = function(userId) {
  const userIdStr = userId.toString();
  if (!this.helpful.users.some(id => id.toString() === userIdStr)) {
    this.helpful.users.push(userId);
    this.helpful.count = this.helpful.users.length;
  }
};

// Method to unmark review as helpful
reviewSchema.methods.unmarkHelpful = function(userId) {
  const userIdStr = userId.toString();
  const initialLength = this.helpful.users.length;
  
  this.helpful.users = this.helpful.users.filter(
    id => id.toString() !== userIdStr
  );
  
  if (this.helpful.users.length < initialLength) {
    this.helpful.count = this.helpful.users.length;
  }
};

// Method to flag review
reviewSchema.methods.flagReview = function(userId, reason) {
  this.flaggedBy.push({
    user: userId,
    reason: reason
  });
  this.isFlagged = true;
};

// Static method to calculate average rating for a provider
reviewSchema.statics.getProviderAverageRating = async function(providerId) {
  const result = await this.aggregate([
    { $match: { provider: providerId, isVisible: true } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating.overall' },
        totalReviews: { $sum: 1 },
        qualityAvg: { $avg: '$rating.quality' },
        punctualityAvg: { $avg: '$rating.punctuality' },
        communicationAvg: { $avg: '$rating.communication' },
        valueAvg: { $avg: '$rating.value' }
      }
    }
  ]);
  
  return result.length > 0 ? result[0] : {
    averageRating: 0,
    totalReviews: 0,
    qualityAvg: 0,
    punctualityAvg: 0,
    communicationAvg: 0,
    valueAvg: 0
  };
};

// Static method to get rating distribution for a provider
reviewSchema.statics.getProviderRatingDistribution = async function(providerId) {
  const result = await this.aggregate([
    { $match: { provider: providerId, isVisible: true } },
    {
      $group: {
        _id: '$rating.overall',
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: -1 } }
  ]);
  
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  result.forEach(item => {
    distribution[item._id] = item.count;
  });
  
  return distribution;
};

// Optimized indexes
reviewSchema.index({ provider: 1, createdAt: -1 });
reviewSchema.index({ client: 1, createdAt: -1 });
reviewSchema.index({ service: 1, createdAt: -1 });
reviewSchema.index({ 'rating.overall': -1 });
reviewSchema.index({ isVisible: 1, isFlagged: 1 });
reviewSchema.index({ provider: 1, isVisible: 1 }); // Added for provider dashboard
reviewSchema.index({ service: 1, 'rating.overall': -1 }); // Added for service ratings

module.exports = mongoose.model('Review', reviewSchema);