const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class PaymentService {
  // Stripe payment processing
  static async createStripePaymentIntent(amount, currency = 'usd', metadata = {}) {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        metadata,
        automatic_payment_methods: {
          enabled: true,
        },
      });

      return {
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      };
    } catch (error) {
      console.error('Stripe payment intent creation failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Confirm Stripe payment
  static async confirmStripePayment(paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      
      return {
        success: paymentIntent.status === 'succeeded',
        status: paymentIntent.status,
        paymentIntent,
      };
    } catch (error) {
      console.error('Stripe payment confirmation failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Create Stripe customer
  static async createStripeCustomer(email, name, metadata = {}) {
    try {
      const customer = await stripe.customers.create({
        email,
        name,
        metadata,
      });

      return {
        success: true,
        customerId: customer.id,
        customer,
      };
    } catch (error) {
      console.error('Stripe customer creation failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Local Egyptian payment methods simulation
  static async processLocalPayment(method, amount, phoneNumber, metadata = {}) {
    try {
      // Simulate payment processing for local methods
      // In production, integrate with actual payment gateways
      
      const supportedMethods = ['vodafone_cash', 'etisalat_cash', 'orange_money', 'we_pay'];
      
      if (!supportedMethods.includes(method)) {
        throw new Error('Unsupported payment method');
      }

      if (!phoneNumber || phoneNumber.length < 10) {
        throw new Error('Invalid phone number');
      }

      if (amount < 1) {
        throw new Error('Invalid amount');
      }

      // Simulate API call to payment provider
      const transactionId = `${method}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Simulate success rate (95% success for demo)
      const isSuccess = Math.random() > 0.05;
      
      if (!isSuccess) {
        throw new Error('Payment processing failed. Please try again.');
      }

      return {
        success: true,
        transactionId,
        method,
        amount,
        phoneNumber,
        status: 'completed',
        timestamp: new Date(),
        metadata,
      };
    } catch (error) {
      console.error('Local payment processing failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // PayPal payment processing (simulation)
  static async createPayPalOrder(amount, currency = 'USD', metadata = {}) {
    try {
      // In production, integrate with PayPal SDK
      // This is a simulation for demo purposes
      
      const orderId = `PAYPAL_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      return {
        success: true,
        orderId,
        approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`,
        amount,
        currency,
        metadata,
      };
    } catch (error) {
      console.error('PayPal order creation failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Capture PayPal payment
  static async capturePayPalPayment(orderId) {
    try {
      // Simulate PayPal payment capture
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const isSuccess = Math.random() > 0.05; // 95% success rate
      
      if (!isSuccess) {
        throw new Error('PayPal payment capture failed');
      }

      return {
        success: true,
        orderId,
        status: 'completed',
        captureId: `CAPTURE_${Date.now()}`,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error('PayPal payment capture failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Provider withdrawal processing
  static async processProviderWithdrawal(providerId, amount, method, accountDetails) {
    try {
      if (amount < 50) { // Minimum withdrawal amount
        throw new Error('Minimum withdrawal amount is 50 EGP');
      }

      const withdrawalId = `WD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Simulate withdrawal processing
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      return {
        success: true,
        withdrawalId,
        providerId,
        amount,
        method,
        status: 'processing',
        estimatedCompletion: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        timestamp: new Date(),
      };
    } catch (error) {
      console.error('Provider withdrawal failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Calculate platform fees
  static calculatePlatformFee(amount, feeType = 'booking') {
    const fees = {
      booking: 5, // 5 EGP per booking
      activation: 20, // 20 EGP activation fee
      withdrawal: 0.02, // 2% withdrawal fee
    };

    if (feeType === 'withdrawal') {
      return Math.max(amount * fees.withdrawal, 2); // Minimum 2 EGP
    }

    return fees[feeType] || 0;
  }

  // Validate payment method
  static validatePaymentMethod(method, details) {
    const validMethods = {
      stripe: ['card_number', 'exp_month', 'exp_year', 'cvc'],
      vodafone_cash: ['phone_number'],
      etisalat_cash: ['phone_number'],
      orange_money: ['phone_number'],
      we_pay: ['phone_number'],
      paypal: ['email'],
    };

    if (!validMethods[method]) {
      return { valid: false, error: 'Unsupported payment method' };
    }

    const requiredFields = validMethods[method];
    const missingFields = requiredFields.filter(field => !details[field]);

    if (missingFields.length > 0) {
      return {
        valid: false,
        error: `Missing required fields: ${missingFields.join(', ')}`,
      };
    }

    return { valid: true };
  }

  // Format amount for display
  static formatAmount(amount, currency = 'EGP') {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency === 'EGP' ? 'USD' : currency, // Use USD format for EGP
      minimumFractionDigits: 2,
    });

    if (currency === 'EGP') {
      return formatter.format(amount).replace('$', 'EGP ');
    }

    return formatter.format(amount);
  }
}

module.exports = PaymentService;

