const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Payment = require('../models/Payment');
const { authenticateUser, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { verifyFirebaseToken, setCustomUserClaims } = require('../config/firebase');

const router = express.Router();

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('name').trim().isLength({ min: 2, max: 50 }),
  body('phone').isMobilePhone(),
  body('role').isIn(['client', 'provider']),
  body('firebaseUid').notEmpty()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const { email, name, phone, role, firebaseUid, location, providerInfo } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({
    $or: [{ email }, { firebaseUid }]
  });

  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: 'User already exists'
    });
  }

  // Create user data
  const userData = {
    firebaseUid,
    email,
    name,
    phone,
    role,
    location
  };

  // Add provider-specific data if role is provider
  if (role === 'provider' && providerInfo) {
    userData.providerInfo = {
      businessName: providerInfo.businessName,
      description: providerInfo.description,
      experience: providerInfo.experience,
      workingHours: providerInfo.workingHours,
      serviceRadius: providerInfo.serviceRadius
    };
  }

  // Create user
  const user = await User.create(userData);

  // Set custom claims in Firebase
  await setCustomUserClaims(firebaseUid, { role, userId: user._id.toString() });

  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: {
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        isVerified: user.isVerified,
        ...(role === 'provider' && {
          isActivated: user.providerInfo.isActivated,
          activationFeePaid: user.providerInfo.activationFeePaid
        })
      }
    }
  });
}));

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post('/login', [
  body('firebaseToken').notEmpty()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Firebase token is required',
      errors: errors.array()
    });
  }

  const { firebaseToken, fcmToken } = req.body;

  // Verify Firebase token
  const decodedToken = await verifyFirebaseToken(firebaseToken);

  // Find user in database
  const user = await User.findOne({ firebaseUid: decodedToken.uid });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found. Please register first.'
    });
  }

  if (!user.isActive) {
    return res.status(401).json({
      success: false,
      message: 'Account is deactivated. Please contact support.'
    });
  }

  // Update FCM token and last login
  if (fcmToken) {
    user.fcmToken = fcmToken;
  }
  user.lastLogin = new Date();
  await user.save();

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        location: user.location,
        language: user.language,
        isActive: user.isActive,
        isVerified: user.isVerified,
        notifications: user.notifications,
        ...(user.role === 'provider' && {
          providerInfo: {
            businessName: user.providerInfo.businessName,
            description: user.providerInfo.description,
            isActivated: user.providerInfo.isActivated,
            activationFeePaid: user.providerInfo.activationFeePaid,
            rating: user.providerInfo.rating,
            wallet: user.providerInfo.wallet,
            subscriptionPlan: user.providerInfo.subscriptionPlan
          }
        }),
        ...(user.role === 'client' && {
          clientInfo: user.clientInfo
        })
      }
    }
  });
}));

// @desc    Get current user profile
// @route   GET /api/auth/profile
// @access  Private
router.get('/profile', authenticateUser, asyncHandler(async (req, res) => {
  const user = req.user;

  res.json({
    success: true,
    data: {
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        location: user.location,
        language: user.language,
        isActive: user.isActive,
        isVerified: user.isVerified,
        notifications: user.notifications,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
        ...(user.role === 'provider' && {
          providerInfo: user.providerInfo
        }),
        ...(user.role === 'client' && {
          clientInfo: user.clientInfo
        })
      }
    }
  });
}));

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
router.put('/profile', authenticateUser, [
  body('name').optional().trim().isLength({ min: 2, max: 50 }),
  body('phone').optional().isMobilePhone(),
  body('language').optional().isIn(['ar', 'en'])
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const user = req.user;
  const { name, phone, location, language, notifications, providerInfo } = req.body;

  // Update basic fields
  if (name) user.name = name;
  if (phone) user.phone = phone;
  if (location) user.location = location;
  if (language) user.language = language;
  if (notifications) user.notifications = { ...user.notifications, ...notifications };

  // Update provider-specific fields
  if (user.role === 'provider' && providerInfo) {
    user.providerInfo = { ...user.providerInfo, ...providerInfo };
  }

  await user.save();

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: {
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        location: user.location,
        language: user.language,
        notifications: user.notifications,
        ...(user.role === 'provider' && {
          providerInfo: user.providerInfo
        })
      }
    }
  });
}));

// @desc    Pay provider activation fee
// @route   POST /api/auth/pay-activation-fee
// @access  Private (Provider only)
router.post('/pay-activation-fee', authenticateUser, requireRole('provider'), [
  body('paymentMethod').isIn(['vodafone_cash', 'etisalat_cash', 'orange_money', 'we_pay', 'stripe']),
  body('phoneNumber').optional().isMobilePhone()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const user = req.user;
  const { paymentMethod, phoneNumber } = req.body;

  // Check if activation fee already paid
  if (user.providerInfo.activationFeePaid) {
    return res.status(400).json({
      success: false,
      message: 'Activation fee already paid'
    });
  }

  const activationFee = process.env.PROVIDER_ACTIVATION_FEE || 20;

  // Create payment record
  const payment = await Payment.create({
    type: 'activation_fee',
    user: user._id,
    amount: activationFee,
    currency: 'EGP',
    method: paymentMethod,
    description: 'Provider activation fee',
    ...(phoneNumber && {
      mobilePayment: { phoneNumber }
    })
  });

  // For demo purposes, we'll mark the payment as completed
  // In production, this would integrate with actual payment providers
  payment.status = 'completed';
  payment.completedAt = new Date();
  await payment.save();

  // Update user activation status
  user.providerInfo.activationFeePaid = true;
  user.providerInfo.isActivated = true;
  user.providerInfo.activationDate = new Date();
  user.providerInfo.activationFeePaymentId = payment.paymentId;
  await user.save();

  res.json({
    success: true,
    message: 'Activation fee paid successfully. Your provider account is now activated!',
    data: {
      payment: {
        id: payment._id,
        paymentId: payment.paymentId,
        amount: payment.amount,
        status: payment.status
      },
      user: {
        isActivated: user.providerInfo.isActivated,
        activationDate: user.providerInfo.activationDate
      }
    }
  });
}));

// @desc    Refresh user token
// @route   POST /api/auth/refresh
// @access  Private
router.post('/refresh', authenticateUser, asyncHandler(async (req, res) => {
  const user = req.user;

  res.json({
    success: true,
    message: 'Token refreshed successfully',
    data: {
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive
      }
    }
  });
}));

// @desc    Update FCM token
// @route   POST /api/auth/fcm-token
// @access  Private
router.post('/fcm-token', authenticateUser, [
  body('fcmToken').notEmpty()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'FCM token is required',
      errors: errors.array()
    });
  }

  const user = req.user;
  const { fcmToken } = req.body;

  user.fcmToken = fcmToken;
  await user.save();

  res.json({
    success: true,
    message: 'FCM token updated successfully'
  });
}));

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
router.post('/logout', authenticateUser, asyncHandler(async (req, res) => {
  const user = req.user;

  // Clear FCM token
  user.fcmToken = null;
  await user.save();

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}));

module.exports = router;

