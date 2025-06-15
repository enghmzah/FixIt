const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Booking = require('../models/Booking');
const { verifyFirebaseToken } = require('../config/firebase');

// Store active connections
const activeConnections = new Map();

const socketHandler = (io) => {
  // Authentication middleware for socket connections
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      // Verify Firebase token
      const decodedToken = await verifyFirebaseToken(token);
      
      // Find user in database
      const user = await User.findOne({ firebaseUid: decodedToken.uid });
      
      if (!user || !user.isActive) {
        return next(new Error('User not found or inactive'));
      }

      socket.userId = user._id.toString();
      socket.user = user;
      
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User ${socket.user.name} connected with socket ID: ${socket.id}`);
    
    // Store active connection
    activeConnections.set(socket.userId, {
      socketId: socket.id,
      user: socket.user,
      connectedAt: new Date()
    });

    // Join user to their personal room
    socket.join(`user_${socket.userId}`);

    // Join user to their booking rooms
    socket.on('join_booking_rooms', async () => {
      try {
        let bookingQuery = {};
        
        if (socket.user.role === 'client') {
          bookingQuery.client = socket.userId;
        } else if (socket.user.role === 'provider') {
          bookingQuery.provider = socket.userId;
        }

        const bookings = await Booking.find(bookingQuery).select('_id');
        
        bookings.forEach(booking => {
          socket.join(`booking_${booking._id}`);
        });

        socket.emit('joined_booking_rooms', { count: bookings.length });
      } catch (error) {
        console.error('Error joining booking rooms:', error);
        socket.emit('error', { message: 'Failed to join booking rooms' });
      }
    });

    // Handle joining specific booking room
    socket.on('join_booking', async (data) => {
      try {
        const { bookingId } = data;
        
        // Verify user has access to this booking
        const booking = await Booking.findById(bookingId);
        
        if (!booking) {
          socket.emit('error', { message: 'Booking not found' });
          return;
        }

        const hasAccess = booking.client.toString() === socket.userId ||
                         booking.provider.toString() === socket.userId ||
                         socket.user.role === 'admin';

        if (!hasAccess) {
          socket.emit('error', { message: 'Access denied to booking' });
          return;
        }

        socket.join(`booking_${bookingId}`);
        socket.emit('joined_booking', { bookingId });

        // Mark messages as delivered
        await Message.markAllAsDelivered(bookingId, socket.userId);
        
        // Notify other party that user is online
        socket.to(`booking_${bookingId}`).emit('user_online', {
          userId: socket.userId,
          userName: socket.user.name
        });

      } catch (error) {
        console.error('Error joining booking:', error);
        socket.emit('error', { message: 'Failed to join booking' });
      }
    });

    // Handle leaving booking room
    socket.on('leave_booking', (data) => {
      const { bookingId } = data;
      socket.leave(`booking_${bookingId}`);
      
      // Notify other party that user went offline
      socket.to(`booking_${bookingId}`).emit('user_offline', {
        userId: socket.userId,
        userName: socket.user.name
      });
      
      socket.emit('left_booking', { bookingId });
    });

    // Handle sending messages
    socket.on('send_message', async (data) => {
      try {
        const { bookingId, content, type = 'text', attachments, replyTo } = data;

        // Verify booking access
        const booking = await Booking.findById(bookingId);
        
        if (!booking) {
          socket.emit('error', { message: 'Booking not found' });
          return;
        }

        const hasAccess = booking.client.toString() === socket.userId ||
                         booking.provider.toString() === socket.userId;

        if (!hasAccess) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // Determine receiver
        const receiverId = booking.client.toString() === socket.userId 
          ? booking.provider.toString() 
          : booking.client.toString();

        // Create message
        const messageData = {
          booking: bookingId,
          sender: socket.userId,
          receiver: receiverId,
          content,
          type,
          attachments: attachments || []
        };

        if (replyTo) {
          messageData.replyTo = replyTo;
        }

        const message = await Message.create(messageData);

        // Populate message
        await message.populate([
          { path: 'sender', select: 'name avatar' },
          { path: 'receiver', select: 'name avatar' },
          { path: 'replyTo', select: 'content sender' }
        ]);

        // Emit to booking room
        io.to(`booking_${bookingId}`).emit('new_message', {
          message,
          bookingId
        });

        // Send push notification to receiver if offline
        const receiverConnection = activeConnections.get(receiverId);
        if (!receiverConnection) {
          // Send push notification
          const receiver = await User.findById(receiverId);
          if (receiver && receiver.fcmToken && receiver.notifications.push) {
            // Push notification logic would go here
            console.log(`Sending push notification to ${receiver.name}`);
          }
        }

        socket.emit('message_sent', { messageId: message._id });

      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle typing indicators
    socket.on('typing_start', (data) => {
      const { bookingId } = data;
      socket.to(`booking_${bookingId}`).emit('user_typing', {
        userId: socket.userId,
        userName: socket.user.name,
        bookingId
      });
    });

    socket.on('typing_stop', (data) => {
      const { bookingId } = data;
      socket.to(`booking_${bookingId}`).emit('user_stopped_typing', {
        userId: socket.userId,
        userName: socket.user.name,
        bookingId
      });
    });

    // Handle message read receipts
    socket.on('mark_messages_read', async (data) => {
      try {
        const { bookingId, messageIds } = data;

        // Update messages as read
        await Message.updateMany({
          _id: { $in: messageIds },
          booking: bookingId,
          receiver: socket.userId
        }, {
          status: 'read'
        });

        // Add read receipts
        const messages = await Message.find({
          _id: { $in: messageIds },
          booking: bookingId
        });

        for (const message of messages) {
          message.markAsRead(socket.userId);
          await message.save();
        }

        // Notify sender about read receipts
        socket.to(`booking_${bookingId}`).emit('messages_read', {
          messageIds,
          readBy: socket.userId,
          readAt: new Date()
        });

        socket.emit('messages_marked_read', { messageIds });

      } catch (error) {
        console.error('Error marking messages as read:', error);
        socket.emit('error', { message: 'Failed to mark messages as read' });
      }
    });

    // Handle booking status updates
    socket.on('booking_status_update', async (data) => {
      try {
        const { bookingId, status, message } = data;

        // Verify booking access and permissions
        const booking = await Booking.findById(bookingId);
        
        if (!booking) {
          socket.emit('error', { message: 'Booking not found' });
          return;
        }

        const hasAccess = booking.client.toString() === socket.userId ||
                         booking.provider.toString() === socket.userId ||
                         socket.user.role === 'admin';

        if (!hasAccess) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // Emit status update to booking room
        io.to(`booking_${bookingId}`).emit('booking_status_changed', {
          bookingId,
          status,
          message,
          updatedBy: {
            id: socket.userId,
            name: socket.user.name,
            role: socket.user.role
          },
          timestamp: new Date()
        });

      } catch (error) {
        console.error('Error handling booking status update:', error);
        socket.emit('error', { message: 'Failed to update booking status' });
      }
    });

    // Handle location sharing
    socket.on('share_location', (data) => {
      const { bookingId, location } = data;
      
      socket.to(`booking_${bookingId}`).emit('location_shared', {
        userId: socket.userId,
        userName: socket.user.name,
        location,
        timestamp: new Date()
      });
    });

    // Handle general notifications
    socket.on('send_notification', async (data) => {
      try {
        const { userId, title, body, type, data: notificationData } = data;

        // Only admins can send general notifications
        if (socket.user.role !== 'admin') {
          socket.emit('error', { message: 'Permission denied' });
          return;
        }

        // Send to specific user
        if (userId) {
          io.to(`user_${userId}`).emit('notification', {
            title,
            body,
            type,
            data: notificationData,
            timestamp: new Date()
          });
        } else {
          // Broadcast to all users
          io.emit('notification', {
            title,
            body,
            type,
            data: notificationData,
            timestamp: new Date()
          });
        }

      } catch (error) {
        console.error('Error sending notification:', error);
        socket.emit('error', { message: 'Failed to send notification' });
      }
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log(`User ${socket.user.name} disconnected: ${reason}`);
      
      // Remove from active connections
      activeConnections.delete(socket.userId);

      // Notify all booking rooms that user went offline
      socket.rooms.forEach(room => {
        if (room.startsWith('booking_')) {
          socket.to(room).emit('user_offline', {
            userId: socket.userId,
            userName: socket.user.name
          });
        }
      });
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    // Send initial connection success
    socket.emit('connected', {
      message: 'Connected successfully',
      userId: socket.userId,
      userName: socket.user.name,
      timestamp: new Date()
    });
  });

  // Helper function to send notification to user
  const sendNotificationToUser = (userId, notification) => {
    io.to(`user_${userId}`).emit('notification', {
      ...notification,
      timestamp: new Date()
    });
  };

  // Helper function to send notification to booking participants
  const sendNotificationToBooking = (bookingId, notification) => {
    io.to(`booking_${bookingId}`).emit('booking_notification', {
      ...notification,
      bookingId,
      timestamp: new Date()
    });
  };

  // Helper function to get online users count
  const getOnlineUsersCount = () => {
    return activeConnections.size;
  };

  // Helper function to check if user is online
  const isUserOnline = (userId) => {
    return activeConnections.has(userId);
  };

  // Export helper functions for use in other parts of the application
  return {
    sendNotificationToUser,
    sendNotificationToBooking,
    getOnlineUsersCount,
    isUserOnline,
    activeConnections
  };
};

module.exports = socketHandler;

