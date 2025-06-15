const nodemailer = require('nodemailer');
const { sendNotificationToUser } = require('../config/firebase');

class NotificationService {
  constructor() {
    // Initialize email transporter
    this.emailTransporter = nodemailer.createTransport({
      service: 'gmail', // You can change this to your preferred email service
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    // Email templates
    this.emailTemplates = {
      welcome: {
        subject: 'Welcome to SalliH!',
        subjectAr: 'مرحباً بك في صالح!',
      },
      bookingConfirmation: {
        subject: 'Booking Confirmation - SalliH',
        subjectAr: 'تأكيد الحجز - صالح',
      },
      bookingStatusUpdate: {
        subject: 'Booking Status Update - SalliH',
        subjectAr: 'تحديث حالة الحجز - صالح',
      },
      paymentConfirmation: {
        subject: 'Payment Confirmation - SalliH',
        subjectAr: 'تأكيد الدفع - صالح',
      },
      providerActivation: {
        subject: 'Provider Account Activated - SalliH',
        subjectAr: 'تم تفعيل حساب مقدم الخدمة - صالح',
      },
      withdrawalProcessed: {
        subject: 'Withdrawal Processed - SalliH',
        subjectAr: 'تم معالجة السحب - صالح',
      },
    };
  }

  // Send email notification
  async sendEmail(to, templateType, data, language = 'en') {
    try {
      const template = this.emailTemplates[templateType];
      if (!template) {
        throw new Error(`Email template '${templateType}' not found`);
      }

      const subject = language === 'ar' ? template.subjectAr : template.subject;
      const html = this.generateEmailHTML(templateType, data, language);

      const mailOptions = {
        from: `"SalliH Platform" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html,
      };

      const result = await this.emailTransporter.sendMail(mailOptions);
      console.log('Email sent successfully:', result.messageId);
      
      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      console.error('Email sending failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Generate email HTML content
  generateEmailHTML(templateType, data, language = 'en') {
    const isRTL = language === 'ar';
    const direction = isRTL ? 'rtl' : 'ltr';
    
    const baseStyle = `
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; direction: ${direction}; }
        .container { max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { background-color: #3b82f6; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; color: #666; }
        .button { display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
        .highlight { background-color: #e3f2fd; padding: 15px; border-radius: 6px; margin: 15px 0; }
      </style>
    `;

    switch (templateType) {
      case 'welcome':
        return `
          ${baseStyle}
          <div class="container">
            <div class="header">
              <h1>SalliH</h1>
              <h2>${isRTL ? 'مرحباً بك!' : 'Welcome!'}</h2>
            </div>
            <div class="content">
              <p>${isRTL ? `مرحباً ${data.name}،` : `Hello ${data.name},`}</p>
              <p>${isRTL ? 'مرحباً بك في منصة صالح لخدمات المنزل. نحن سعداء لانضمامك إلينا!' : 'Welcome to SalliH home services platform. We\'re excited to have you join us!'}</p>
              <div class="highlight">
                <p><strong>${isRTL ? 'نوع الحساب:' : 'Account Type:'}</strong> ${isRTL ? (data.role === 'provider' ? 'مقدم خدمة' : 'عميل') : (data.role === 'provider' ? 'Service Provider' : 'Client')}</p>
              </div>
              <a href="${process.env.FRONTEND_URL}" class="button">${isRTL ? 'ابدأ الآن' : 'Get Started'}</a>
            </div>
            <div class="footer">
              <p>${isRTL ? 'شكراً لاختيارك صالح' : 'Thank you for choosing SalliH'}</p>
            </div>
          </div>
        `;

      case 'bookingConfirmation':
        return `
          ${baseStyle}
          <div class="container">
            <div class="header">
              <h1>SalliH</h1>
              <h2>${isRTL ? 'تأكيد الحجز' : 'Booking Confirmation'}</h2>
            </div>
            <div class="content">
              <p>${isRTL ? `مرحباً ${data.clientName}،` : `Hello ${data.clientName},`}</p>
              <p>${isRTL ? 'تم تأكيد حجزك بنجاح!' : 'Your booking has been confirmed successfully!'}</p>
              <div class="highlight">
                <p><strong>${isRTL ? 'رقم الحجز:' : 'Booking ID:'}</strong> ${data.bookingId}</p>
                <p><strong>${isRTL ? 'الخدمة:' : 'Service:'}</strong> ${isRTL ? data.serviceNameAr : data.serviceName}</p>
                <p><strong>${isRTL ? 'مقدم الخدمة:' : 'Provider:'}</strong> ${data.providerName}</p>
                <p><strong>${isRTL ? 'التاريخ:' : 'Date:'}</strong> ${new Date(data.scheduledDate).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US')}</p>
                <p><strong>${isRTL ? 'السعر:' : 'Price:'}</strong> ${data.price} EGP</p>
              </div>
              <a href="${process.env.FRONTEND_URL}/bookings/${data.bookingId}" class="button">${isRTL ? 'عرض الحجز' : 'View Booking'}</a>
            </div>
            <div class="footer">
              <p>${isRTL ? 'شكراً لاستخدام صالح' : 'Thank you for using SalliH'}</p>
            </div>
          </div>
        `;

      case 'paymentConfirmation':
        return `
          ${baseStyle}
          <div class="container">
            <div class="header">
              <h1>SalliH</h1>
              <h2>${isRTL ? 'تأكيد الدفع' : 'Payment Confirmation'}</h2>
            </div>
            <div class="content">
              <p>${isRTL ? `مرحباً ${data.userName}،` : `Hello ${data.userName},`}</p>
              <p>${isRTL ? 'تم استلام دفعتك بنجاح!' : 'Your payment has been received successfully!'}</p>
              <div class="highlight">
                <p><strong>${isRTL ? 'رقم المعاملة:' : 'Transaction ID:'}</strong> ${data.transactionId}</p>
                <p><strong>${isRTL ? 'المبلغ:' : 'Amount:'}</strong> ${data.amount} EGP</p>
                <p><strong>${isRTL ? 'طريقة الدفع:' : 'Payment Method:'}</strong> ${data.paymentMethod}</p>
                <p><strong>${isRTL ? 'التاريخ:' : 'Date:'}</strong> ${new Date(data.timestamp).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US')}</p>
              </div>
            </div>
            <div class="footer">
              <p>${isRTL ? 'شكراً لثقتك في صالح' : 'Thank you for your trust in SalliH'}</p>
            </div>
          </div>
        `;

      default:
        return `
          ${baseStyle}
          <div class="container">
            <div class="header">
              <h1>SalliH</h1>
            </div>
            <div class="content">
              <p>${isRTL ? 'شكراً لاستخدام منصة صالح!' : 'Thank you for using SalliH platform!'}</p>
            </div>
          </div>
        `;
    }
  }

  // Send FCM notification
  async sendFCMNotification(userId, title, body, data = {}, language = 'en') {
    try {
      const result = await sendNotificationToUser(userId, {
        title,
        body,
        data: {
          ...data,
          language,
          timestamp: new Date().toISOString(),
        },
      });

      return {
        success: true,
        result,
      };
    } catch (error) {
      console.error('FCM notification failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Send in-app notification (via Socket.io)
  async sendInAppNotification(io, userId, notification) {
    try {
      io.to(`user_${userId}`).emit('notification', {
        id: `notif_${Date.now()}`,
        ...notification,
        timestamp: new Date(),
        read: false,
      });

      return { success: true };
    } catch (error) {
      console.error('In-app notification failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Send comprehensive notification (email + FCM + in-app)
  async sendComprehensiveNotification(io, userId, userEmail, notificationType, data, language = 'en') {
    const results = {
      email: null,
      fcm: null,
      inApp: null,
    };

    try {
      // Send email notification
      if (userEmail) {
        results.email = await this.sendEmail(userEmail, notificationType, data, language);
      }

      // Send FCM notification
      const fcmData = this.getFCMNotificationData(notificationType, data, language);
      if (fcmData) {
        results.fcm = await this.sendFCMNotification(
          userId,
          fcmData.title,
          fcmData.body,
          fcmData.data,
          language
        );
      }

      // Send in-app notification
      const inAppData = this.getInAppNotificationData(notificationType, data, language);
      if (inAppData && io) {
        results.inApp = await this.sendInAppNotification(io, userId, inAppData);
      }

      return {
        success: true,
        results,
      };
    } catch (error) {
      console.error('Comprehensive notification failed:', error);
      return {
        success: false,
        error: error.message,
        results,
      };
    }
  }

  // Get FCM notification data
  getFCMNotificationData(type, data, language = 'en') {
    const isRTL = language === 'ar';

    const notifications = {
      bookingConfirmation: {
        title: isRTL ? 'تم تأكيد الحجز' : 'Booking Confirmed',
        body: isRTL ? `تم تأكيد حجزك لخدمة ${data.serviceNameAr || data.serviceName}` : `Your booking for ${data.serviceName} has been confirmed`,
        data: { type: 'booking', bookingId: data.bookingId },
      },
      bookingStatusUpdate: {
        title: isRTL ? 'تحديث حالة الحجز' : 'Booking Status Update',
        body: isRTL ? `تم تحديث حالة حجزك إلى: ${data.statusAr || data.status}` : `Your booking status has been updated to: ${data.status}`,
        data: { type: 'booking', bookingId: data.bookingId, status: data.status },
      },
      newMessage: {
        title: isRTL ? 'رسالة جديدة' : 'New Message',
        body: isRTL ? `رسالة جديدة من ${data.senderName}` : `New message from ${data.senderName}`,
        data: { type: 'message', bookingId: data.bookingId, senderId: data.senderId },
      },
      paymentConfirmation: {
        title: isRTL ? 'تم تأكيد الدفع' : 'Payment Confirmed',
        body: isRTL ? `تم استلام دفعة بقيمة ${data.amount} جنيه` : `Payment of ${data.amount} EGP received`,
        data: { type: 'payment', transactionId: data.transactionId },
      },
    };

    return notifications[type] || null;
  }

  // Get in-app notification data
  getInAppNotificationData(type, data, language = 'en') {
    const fcmData = this.getFCMNotificationData(type, data, language);
    if (!fcmData) return null;

    return {
      type,
      title: fcmData.title,
      body: fcmData.body,
      data: fcmData.data,
      priority: this.getNotificationPriority(type),
    };
  }

  // Get notification priority
  getNotificationPriority(type) {
    const priorities = {
      bookingConfirmation: 'high',
      bookingStatusUpdate: 'high',
      newMessage: 'medium',
      paymentConfirmation: 'high',
      providerActivation: 'medium',
      withdrawalProcessed: 'medium',
    };

    return priorities[type] || 'low';
  }

  // Test email configuration
  async testEmailConfiguration() {
    try {
      await this.emailTransporter.verify();
      return { success: true, message: 'Email configuration is valid' };
    } catch (error) {
      console.error('Email configuration test failed:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new NotificationService();

