const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  // Basic Information
  name: {
    ar: {
      type: String,
      required: true
    },
    en: {
      type: String,
      required: true
    }
  },
  description: {
    ar: {
      type: String,
      required: true
    },
    en: {
      type: String,
      required: true
    }
  },
  
  // Category
  category: {
    type: String,
    required: true,
    enum: [
      'plumbing',
      'electrical',
      'carpentry',
      'painting',
      'cleaning',
      'appliance_repair',
      'hvac',
      'gardening',
      'handyman',
      'pest_control',
      'moving',
      'security',
      'other'
    ]
  },
  
  // Provider
  provider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Pricing
  pricing: {
    type: {
      type: String,
      enum: ['fixed', 'hourly', 'custom'],
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: 'EGP'
    },
    unit: String // e.g., 'per hour', 'per room', 'per service'
  },
  
  // Service Details
  duration: {
    estimated: Number, // in minutes
    minimum: Number,
    maximum: Number
  },
  
  // Availability
  availability: {
    days: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    }],
    hours: {
      start: String, // e.g., "09:00"
      end: String    // e.g., "17:00"
    },
    advanceBooking: {
      minimum: Number, // hours
      maximum: Number  // days
    }
  },
  
  // Service Area
  serviceArea: {
    cities: [String],
    governorates: [String],
    radius: Number // km from provider location
  },
  
  // Media
  images: [String], // URLs to service images
  
  // Requirements
  requirements: {
    ar: [String],
    en: [String]
  },
  
  // What's included
  includes: {
    ar: [String],
    en: [String]
  },
  
  // Additional options
  addOns: [{
    name: {
      ar: String,
      en: String
    },
    price: Number,
    description: {
      ar: String,
      en: String
    }
  }],
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  
  // Statistics
  stats: {
    totalBookings: {
      type: Number,
      default: 0
    },
    completedBookings: {
      type: Number,
      default: 0
    },
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
    views: {
      type: Number,
      default: 0
    }
  },
  
  // SEO
  slug: {
    type: String,
    unique: true
  },
  tags: {
    ar: [String],
    en: [String]
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

// Create slug before saving
serviceSchema.pre('save', function(next) {
  if (this.isModified('name.en') || this.isNew) {
    this.slug = this.name.en.toLowerCase()
      .replace(/[^\w ]+/g, '')
      .replace(/ +/g, '-') + '-' + Date.now();
  }
  this.updatedAt = Date.now();
  next();
});

// Method to update service rating
serviceSchema.methods.updateRating = function(newRating) {
  const currentTotal = this.stats.rating.average * this.stats.rating.count;
  this.stats.rating.count += 1;
  this.stats.rating.average = (currentTotal + newRating) / this.stats.rating.count;
};

// Method to increment booking count
serviceSchema.methods.incrementBooking = function() {
  this.stats.totalBookings += 1;
};

// Method to increment completed booking count
serviceSchema.methods.incrementCompleted = function() {
  this.stats.completedBookings += 1;
};

// Method to increment views
serviceSchema.methods.incrementViews = function() {
  this.stats.views += 1;
};

// Index for search
serviceSchema.index({
  'name.ar': 'text',
  'name.en': 'text',
  'description.ar': 'text',
  'description.en': 'text',
  'tags.ar': 'text',
  'tags.en': 'text'
});

serviceSchema.index({ category: 1 });
serviceSchema.index({ provider: 1 });
serviceSchema.index({ 'stats.rating.average': -1 });
serviceSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Service', serviceSchema);

