const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const serviceRoutes = require('./routes/services');
const bookingRoutes = require('./routes/bookings');
const reviewRoutes = require('./routes/reviews');
const paymentRoutes = require('./routes/payments');
const chatRoutes = require('./routes/chat');
const adminRoutes = require('./routes/admin');

// Import middleware
const authMiddleware = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

// Import socket handlers
const socketHandler = require('./socket/socketHandler');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.SOCKET_CORS_ORIGIN || "*",
    methods: ["GET", "POST"]
  }
});

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use('/uploads', express.static('uploads'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'SalliH API is running',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Connect to MongoDB and start the server only if successful
const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('✅ Connected to MongoDB');

  // Start socket.io handler
  socketHandler(io);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SalliH server running on port ${PORT}`);
  });
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1); // Important for Railway to detect failure
});

module.exports = { app, io };
