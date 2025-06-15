const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authenticateUser, requireRole } = require('../middleware/auth');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Booking = require('../models/Booking');
const PaymentService = require('../utils/paymentService');
const NotificationService = require('../utils/notificationService');

// Get payment methods
router.get('/methods', authenticateUser, async (req, res) => {
  try {
    const paymentMethods = [
      {
        id: 'stripe',
        name: 'Credit/Debit Card',
        nameAr: 'بطاقة ائتمان/خصم',
        type: 'international',
        icon: 'credit-card',
        enabled: true,
      },
      {
        id: 'vodafone_cash',
        name: 'Vodafone Cash',
        nameAr: 'فودافون كاش',
        type: 'local',
        icon: 'smartphone',
        enabled: true,
      },
      {
        id: 'etisalat_cash',
        name: 'Etisalat Cash',
        nameAr: 'اتصالات كاش',
        type: 'local',
        icon: 'smartphone',
        enabled: true,
      },
      {
        id: 'orange_money',
        name: 'Orange Money',
        nameAr: 'أورانج موني',
        type: 'local',
        icon: 'smartphone',
        enabled: true,
      },
      {
        id: 'we_pay',
        name: 'WE Pay',
        nameAr: 'وي باي',
        type: 'local',
        icon: 'smartphone',
        enabled: true,
      },
      {
        id: 'paypal',
        name: 'PayPal',
        nameAr: 'باي بال',
        type: 'international',
        icon: 'paypal',
        enabled: true,
      },
    ];

    res.json({
      success: true,
      data: paymentMethods,
    });
  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment methods',
      error: error.message,
    });
  }
});

// Process activation fee payment
router.post('/activation-fee', [
  authenticateUser,
  requireRole('provider'),
  body('paymentMethod').notEmpty().withMessage('Payment method is required'),
  body('paymentDetails').isObject().withMessage('Payment details are required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { paymentMethod, paymentDetails } = req.body;
    const userId = req.user.uid;

    // Check if user is a provider
    const user = await User.findOne({ firebaseUid: userId });
    if (!user || user.role !== 'provider') {
      return res.status(403).json({
        success: false,
        message: 'Only providers can pay activation fee',
      });
    }

    // Check if already activated
    if (user.providerInfo?.isActivated) {
      return res.status(400).json({
        success: false,
        message: 'Provider account is already activated',
      });
    }

    const activationFee = 20; // 20 EGP
    let paymentResult;

    // Process payment based on method
    if (paymentMethod === 'stripe') {
      paymentResult = await PaymentService.createStripePaymentIntent(
        activationFee,
        'usd',
        {
          type: 'activation_fee',
          userId,
          providerId: user._id.toString(),
        }
      );
    } else if (['vodafone_cash', 'etisalat_cash', 'orange_money', 'we_pay'].includes(paymentMethod)) {
      paymentResult = await PaymentService.processLocalPayment(
        paymentMethod,
        activationFee,
        paymentDetails.phoneNumber,
        {
          type: 'activation_fee',
          userId,
          providerId: user._id.toString(),
        }
      );
    } else if (paymentMethod === 'paypal') {
      paymentResult = await PaymentService.createPayPalOrder(
        activationFee,
        'USD',
        {
          type: 'activation_fee',
          userId,
          providerId: user._id.toString(),
        }
      );
    } else {
      return res.status(400).json({
        success: false,
        message: 'Unsupported payment method',
      });
    }

    if (!paymentResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Payment processing failed',
        error: paymentResult.error,
      });
    }

    // Create payment record
    const payment = new Payment({
      user: user._id,
      type: 'activation_fee',
      amount: activationFee,
      currency: 'EGP',
      paymentMethod,
      status: paymentMethod === 'stripe' ? 'pending' : 'completed',
      transactionId: paymentResult.transactionId || paymentResult.paymentIntentId || paymentResult.orderId,
      metadata: {
        type: 'activation_fee',
        providerId: user._id.toString(),
      },
    });

    await payment.save();

    // If payment is completed (local methods), activate provider
    if (paymentResult.success && paymentMethod !== 'stripe' && paymentMethod !== 'paypal') {
      user.providerInfo.isActivated = true;
      user.providerInfo.activatedAt = new Date();
      await user.save();

      // Send activation notification
      await NotificationService.sendComprehensiveNotification(
        req.io,
        userId,
        user.email,
        'providerActivation',
        {
          name: user.name,
          activationDate: new Date(),
        },
        user.preferredLanguage || 'en'
      );
    }

    res.json({
      success: true,
      data: {
        payment: payment._id,
        status: payment.status,
        amount: activationFee,
        ...paymentResult,
      },
    });
  } catch (error) {
    console.error('Activation fee payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process activation fee payment',
      error: error.message,
    });
  }
});

// Process booking payment
router.post('/process', [
  authenticateUser,
  body('bookingId').notEmpty().withMessage('Booking ID is required'),
  body('paymentMethod').notEmpty().withMessage('Payment method is required'),
  body('paymentDetails').isObject().withMessage('Payment details are required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { bookingId, paymentMethod, paymentDetails } = req.body;
    const userId = req.user.uid;

    // Get booking
    const booking = await Booking.findById(bookingId)
      .populate('client')
      .populate('provider')
      .populate('service');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    // Check if user is the client
    if (booking.client.firebaseUid !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized to pay for this booking',
      });
    }

    // Check booking status
    if (booking.status !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: 'Booking must be confirmed before payment',
      });
    }

    // Check if already paid
    if (booking.paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Booking is already paid',
      });
    }

    const totalAmount = booking.totalAmount;
    const platformFee = PaymentService.calculatePlatformFee(totalAmount, 'booking');
    const providerAmount = totalAmount - platformFee;

    let paymentResult;

    // Process payment based on method
    if (paymentMethod === 'stripe') {
      paymentResult = await PaymentService.createStripePaymentIntent(
        totalAmount,
        'usd',
        {
          type: 'booking_payment',
          bookingId: booking._id.toString(),
          clientId: booking.client._id.toString(),
          providerId: booking.provider._id.toString(),
        }
      );
    } else if (['vodafone_cash', 'etisalat_cash', 'orange_money', 'we_pay'].includes(paymentMethod)) {
      paymentResult = await PaymentService.processLocalPayment(
        paymentMethod,
        totalAmount,
        paymentDetails.phoneNumber,
        {
          type: 'booking_payment',
          bookingId: booking._id.toString(),
          clientId: booking.client._id.toString(),
          providerId: booking.provider._id.toString(),
        }
      );
    } else if (paymentMethod === 'paypal') {
      paymentResult = await PaymentService.createPayPalOrder(
        totalAmount,
        'USD',
        {
          type: 'booking_payment',
          bookingId: booking._id.toString(),
          clientId: booking.client._id.toString(),
          providerId: booking.provider._id.toString(),
        }
      );
    } else {
      return res.status(400).json({
        success: false,
        message: 'Unsupported payment method',
      });
    }

    if (!paymentResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Payment processing failed',
        error: paymentResult.error,
      });
    }

    // Create payment record
    const payment = new Payment({
      user: booking.client._id,
      booking: booking._id,
      type: 'booking_payment',
      amount: totalAmount,
      currency: 'EGP',
      paymentMethod,
      status: paymentMethod === 'stripe' ? 'pending' : 'completed',
      transactionId: paymentResult.transactionId || paymentResult.paymentIntentId || paymentResult.orderId,
      metadata: {
        type: 'booking_payment',
        bookingId: booking._id.toString(),
        platformFee,
        providerAmount,
      },
    });

    await payment.save();

    // If payment is completed (local methods), update booking and provider wallet
    if (paymentResult.success && paymentMethod !== 'stripe' && paymentMethod !== 'paypal') {
      booking.paymentStatus = 'paid';
      booking.paidAt = new Date();
      await booking.save();

      // Update provider wallet
      const provider = await User.findById(booking.provider._id);
      if (!provider.providerInfo.wallet) {
        provider.providerInfo.wallet = { balance: 0, totalEarnings: 0 };
      }
      provider.providerInfo.wallet.balance += providerAmount;
      provider.providerInfo.wallet.totalEarnings += providerAmount;
      await provider.save();

      // Send payment confirmation notifications
      await NotificationService.sendComprehensiveNotification(
        req.io,
        booking.client.firebaseUid,
        booking.client.email,
        'paymentConfirmation',
        {
          userName: booking.client.name,
          transactionId: payment.transactionId,
          amount: totalAmount,
          paymentMethod,
          timestamp: new Date(),
          bookingId: booking._id.toString(),
        },
        booking.client.preferredLanguage || 'en'
      );
    }

    res.json({
      success: true,
      data: {
        payment: payment._id,
        status: payment.status,
        amount: totalAmount,
        platformFee,
        providerAmount,
        ...paymentResult,
      },
    });
  } catch (error) {
    console.error('Booking payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process booking payment',
      error: error.message,
    });
  }
});

// Get payment history
router.get('/history', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { page = 1, limit = 10, type, status } = req.query;

    const user = await User.findOne({ firebaseUid: userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const query = { user: user._id };
    if (type) query.type = type;
    if (status) query.status = status;

    const payments = await Payment.find(query)
      .populate('booking')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Payment.countDocuments(query);

    res.json({
      success: true,
      data: {
        payments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment history',
      error: error.message,
    });
  }
});

// Provider withdrawal request
router.post('/withdraw', [
  authenticateUser,
  requireRole('provider'),
  body('amount').isNumeric().withMessage('Amount must be a number'),
  body('method').notEmpty().withMessage('Withdrawal method is required'),
  body('accountDetails').isObject().withMessage('Account details are required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { amount, method, accountDetails } = req.body;
    const userId = req.user.uid;

    const user = await User.findOne({ firebaseUid: userId });
    if (!user || user.role !== 'provider') {
      return res.status(403).json({
        success: false,
        message: 'Only providers can request withdrawals',
      });
    }

    // Check if provider is activated
    if (!user.providerInfo?.isActivated) {
      return res.status(400).json({
        success: false,
        message: 'Provider account must be activated to request withdrawals',
      });
    }

    const currentBalance = user.providerInfo.wallet?.balance || 0;
    const withdrawalFee = PaymentService.calculatePlatformFee(amount, 'withdrawal');
    const totalDeduction = amount + withdrawalFee;

    // Check balance
    if (currentBalance < totalDeduction) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance',
        data: {
          currentBalance,
          requestedAmount: amount,
          withdrawalFee,
          totalRequired: totalDeduction,
        },
      });
    }

    // Process withdrawal
    const withdrawalResult = await PaymentService.processProviderWithdrawal(
      user._id.toString(),
      amount,
      method,
      accountDetails
    );

    if (!withdrawalResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal processing failed',
        error: withdrawalResult.error,
      });
    }

    // Create payment record
    const payment = new Payment({
      user: user._id,
      type: 'withdrawal',
      amount: -amount, // Negative for withdrawal
      currency: 'EGP',
      paymentMethod: method,
      status: 'processing',
      transactionId: withdrawalResult.withdrawalId,
      metadata: {
        type: 'withdrawal',
        withdrawalFee,
        accountDetails,
        estimatedCompletion: withdrawalResult.estimatedCompletion,
      },
    });

    await payment.save();

    // Update provider wallet
    user.providerInfo.wallet.balance -= totalDeduction;
    await user.save();

    // Send withdrawal notification
    await NotificationService.sendComprehensiveNotification(
      req.io,
      userId,
      user.email,
      'withdrawalProcessed',
      {
        userName: user.name,
        amount,
        withdrawalFee,
        method,
        withdrawalId: withdrawalResult.withdrawalId,
        estimatedCompletion: withdrawalResult.estimatedCompletion,
      },
      user.preferredLanguage || 'en'
    );

    res.json({
      success: true,
      data: {
        payment: payment._id,
        withdrawalId: withdrawalResult.withdrawalId,
        amount,
        withdrawalFee,
        newBalance: user.providerInfo.wallet.balance,
        estimatedCompletion: withdrawalResult.estimatedCompletion,
      },
    });
  } catch (error) {
    console.error('Withdrawal request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal request',
      error: error.message,
    });
  }
});

// Webhook for Stripe payment confirmation
router.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // Verify webhook signature (in production)
    // const event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);

    // For demo purposes, simulate webhook processing
    const event = {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_demo_' + Date.now(),
          metadata: {
            type: 'booking_payment',
            bookingId: 'demo_booking_id',
          },
        },
      },
    };

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      
      // Update payment status
      const payment = await Payment.findOne({ transactionId: paymentIntent.id });
      if (payment) {
        payment.status = 'completed';
        await payment.save();

        // If it's a booking payment, update booking and provider wallet
        if (payment.type === 'booking_payment') {
          const booking = await Booking.findById(payment.booking)
            .populate('client')
            .populate('provider');

          if (booking) {
            booking.paymentStatus = 'paid';
            booking.paidAt = new Date();
            await booking.save();

            // Update provider wallet
            const providerAmount = payment.metadata.providerAmount;
            const provider = await User.findById(booking.provider._id);
            if (!provider.providerInfo.wallet) {
              provider.providerInfo.wallet = { balance: 0, totalEarnings: 0 };
            }
            provider.providerInfo.wallet.balance += providerAmount;
            provider.providerInfo.wallet.totalEarnings += providerAmount;
            await provider.save();
          }
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(400).json({
      success: false,
      message: 'Webhook processing failed',
      error: error.message,
    });
  }
});

module.exports = router;

