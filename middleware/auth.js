const { verifyFirebaseToken } = require('../config/firebase');
const User = require('../models/User');

// Middleware to verify Firebase token and authenticate user
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify Firebase token
    const decodedToken = await verifyFirebaseToken(token);
    
    // Find user in database
    const user = await User.findOne({ firebaseUid: decodedToken.uid });
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Attach user to request object
    req.user = user;
    req.firebaseUser = decodedToken;
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

// Middleware to check if user has specific role
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userRole = req.user.role;
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

// Middleware to check if provider is activated
const requireActivatedProvider = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'provider') {
    return res.status(403).json({
      success: false,
      message: 'Provider access required'
    });
  }

  if (!req.user.isProviderActivated()) {
    return res.status(403).json({
      success: false,
      message: 'Provider account not activated. Please pay activation fee.'
    });
  }

  next();
};

// Middleware to check if user owns resource or is admin
const requireOwnershipOrAdmin = (resourceUserField = 'user') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Admin can access everything
    if (req.user.role === 'admin') {
      return next();
    }

    // Check if user owns the resource
    const resourceUserId = req.resource ? req.resource[resourceUserField] : null;
    
    if (!resourceUserId || resourceUserId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    next();
  };
};

// Middleware to check booking access (client, provider, or admin)
const requireBookingAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  // Admin can access everything
  if (req.user.role === 'admin') {
    return next();
  }

  // Check if user is client or provider of the booking
  const booking = req.booking;
  if (!booking) {
    return res.status(404).json({
      success: false,
      message: 'Booking not found'
    });
  }

  const userId = req.user._id.toString();
  const isClient = booking.client.toString() === userId;
  const isProvider = booking.provider.toString() === userId;

  if (!isClient && !isProvider) {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  // Attach user role in booking context
  req.userBookingRole = isClient ? 'client' : 'provider';
  
  next();
};

// Middleware to validate API key (for webhook endpoints)
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const validApiKey = process.env.API_KEY;

  if (!apiKey || apiKey !== validApiKey) {
    return res.status(401).json({
      success: false,
      message: 'Invalid API key'
    });
  }

  next();
};

// Optional authentication middleware (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decodedToken = await verifyFirebaseToken(token);
      const user = await User.findOne({ firebaseUid: decodedToken.uid });
      
      if (user && user.isActive) {
        req.user = user;
        req.firebaseUser = decodedToken;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

module.exports = {
  authenticateUser,
  requireRole,
  requireActivatedProvider,
  requireOwnershipOrAdmin,
  requireBookingAccess,
  validateApiKey,
  optionalAuth
};

