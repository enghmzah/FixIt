// Error handling middleware
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  console.error('Error:', err);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, statusCode: 404 };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = { message, statusCode: 400 };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = { message, statusCode: 400 };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = { message, statusCode: 401 };
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = { message, statusCode: 401 };
  }

  // Firebase errors
  if (err.code && err.code.startsWith('auth/')) {
    const message = getFirebaseErrorMessage(err.code);
    error = { message, statusCode: 401 };
  }

  // Payment errors
  if (err.type === 'StripeCardError') {
    const message = err.message || 'Payment failed';
    error = { message, statusCode: 400 };
  }

  // File upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    const message = 'File too large';
    error = { message, statusCode: 400 };
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    const message = 'Unexpected file field';
    error = { message, statusCode: 400 };
  }

  // Rate limiting errors
  if (err.status === 429) {
    const message = 'Too many requests, please try again later';
    error = { message, statusCode: 429 };
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

// Helper function to get user-friendly Firebase error messages
const getFirebaseErrorMessage = (errorCode) => {
  const errorMessages = {
    'auth/user-not-found': 'User not found',
    'auth/wrong-password': 'Invalid password',
    'auth/email-already-in-use': 'Email already in use',
    'auth/weak-password': 'Password is too weak',
    'auth/invalid-email': 'Invalid email address',
    'auth/user-disabled': 'User account has been disabled',
    'auth/too-many-requests': 'Too many requests, please try again later',
    'auth/operation-not-allowed': 'Operation not allowed',
    'auth/invalid-credential': 'Invalid credentials',
    'auth/credential-already-in-use': 'Credential already in use',
    'auth/invalid-verification-code': 'Invalid verification code',
    'auth/invalid-verification-id': 'Invalid verification ID',
    'auth/missing-verification-code': 'Missing verification code',
    'auth/missing-verification-id': 'Missing verification ID',
    'auth/code-expired': 'Verification code has expired',
    'auth/invalid-phone-number': 'Invalid phone number',
    'auth/missing-phone-number': 'Missing phone number',
    'auth/quota-exceeded': 'Quota exceeded, please try again later',
    'auth/app-not-authorized': 'App not authorized',
    'auth/invalid-api-key': 'Invalid API key',
    'auth/network-request-failed': 'Network request failed',
    'auth/requires-recent-login': 'This operation requires recent authentication',
    'auth/invalid-user-token': 'Invalid user token',
    'auth/user-token-expired': 'User token has expired',
    'auth/null-user': 'User is null',
    'auth/invalid-tenant-id': 'Invalid tenant ID',
    'auth/tenant-id-mismatch': 'Tenant ID mismatch'
  };

  return errorMessages[errorCode] || 'Authentication error';
};

// Async error handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Custom error class
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Not found middleware
const notFound = (req, res, next) => {
  const error = new AppError(`Not found - ${req.originalUrl}`, 404);
  next(error);
};

module.exports = {
  errorHandler,
  asyncHandler,
  AppError,
  notFound
};

