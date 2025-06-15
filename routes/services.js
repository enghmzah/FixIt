const express = require('express');
const { body, query, validationResult } = require('express-validator');
const Service = require('../models/Service');
const User = require('../models/User');
const { authenticateUser, requireRole, requireActivatedProvider } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// @desc    Get all services
// @route   GET /api/services
// @access  Public
router.get('/', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('category').optional().trim(),
  query('city').optional().trim(),
  query('governorate').optional().trim(),
  query('search').optional().trim(),
  query('minPrice').optional().isFloat({ min: 0 }),
  query('maxPrice').optional().isFloat({ min: 0 }),
  query('rating').optional().isFloat({ min: 0, max: 5 }),
  query('sortBy').optional().isIn(['price', 'rating', 'newest', 'popular'])
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const { category, city, governorate, search, minPrice, maxPrice, rating, sortBy } = req.query;

  // Build query
  let query = {
    isActive: true,
    isApproved: true
  };

  if (category) {
    query.category = category;
  }

  if (search) {
    query.$or = [
      { 'name.ar': { $regex: search, $options: 'i' } },
      { 'name.en': { $regex: search, $options: 'i' } },
      { 'description.ar': { $regex: search, $options: 'i' } },
      { 'description.en': { $regex: search, $options: 'i' } },
      { 'tags.ar': { $in: [new RegExp(search, 'i')] } },
      { 'tags.en': { $in: [new RegExp(search, 'i')] } }
    ];
  }

  if (minPrice || maxPrice) {
    query['pricing.amount'] = {};
    if (minPrice) query['pricing.amount'].$gte = parseFloat(minPrice);
    if (maxPrice) query['pricing.amount'].$lte = parseFloat(maxPrice);
  }

  if (rating) {
    query['stats.rating.average'] = { $gte: parseFloat(rating) };
  }

  // Location filter (will be applied after population)
  let locationFilter = {};
  if (city) locationFilter['provider.location.city'] = { $regex: city, $options: 'i' };
  if (governorate) locationFilter['provider.location.governorate'] = { $regex: governorate, $options: 'i' };

  // Build sort
  let sort = {};
  switch (sortBy) {
    case 'price':
      sort = { 'pricing.amount': 1 };
      break;
    case 'rating':
      sort = { 'stats.rating.average': -1 };
      break;
    case 'popular':
      sort = { 'stats.totalBookings': -1 };
      break;
    case 'newest':
    default:
      sort = { createdAt: -1 };
      break;
  }

  // Get services with provider info
  let services = await Service.find(query)
    .populate('provider', 'name avatar location providerInfo.rating providerInfo.businessName')
    .sort(sort)
    .skip(skip)
    .limit(limit);

  // Apply location filter if needed
  if (Object.keys(locationFilter).length > 0) {
    services = services.filter(service => {
      if (city && !service.provider.location.city.toLowerCase().includes(city.toLowerCase())) {
        return false;
      }
      if (governorate && !service.provider.location.governorate.toLowerCase().includes(governorate.toLowerCase())) {
        return false;
      }
      return true;
    });
  }

  // Get total count for pagination
  const total = await Service.countDocuments(query);

  res.json({
    success: true,
    data: {
      services,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
}));

// @desc    Get service by ID
// @route   GET /api/services/:id
// @access  Public
router.get('/:id', asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id)
    .populate('provider', 'name avatar location phone providerInfo');

  if (!service) {
    return res.status(404).json({
      success: false,
      message: 'Service not found'
    });
  }

  // Increment view count
  service.incrementViews();
  await service.save();

  res.json({
    success: true,
    data: {
      service
    }
  });
}));

// @desc    Create new service
// @route   POST /api/services
// @access  Private (Activated Provider only)
router.post('/', authenticateUser, requireActivatedProvider, [
  body('name.ar').notEmpty().trim(),
  body('name.en').notEmpty().trim(),
  body('description.ar').notEmpty().trim(),
  body('description.en').notEmpty().trim(),
  body('category').isIn([
    'plumbing', 'electrical', 'carpentry', 'painting', 'cleaning',
    'appliance_repair', 'hvac', 'gardening', 'handyman', 'pest_control',
    'moving', 'security', 'other'
  ]),
  body('pricing.type').isIn(['fixed', 'hourly', 'custom']),
  body('pricing.amount').isFloat({ min: 0 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const serviceData = {
    ...req.body,
    provider: req.user._id
  };

  const service = await Service.create(serviceData);

  // Add service to provider's services list
  req.user.providerInfo.services.push(service._id);
  await req.user.save();

  res.status(201).json({
    success: true,
    message: 'Service created successfully. Awaiting admin approval.',
    data: {
      service
    }
  });
}));

// @desc    Update service
// @route   PUT /api/services/:id
// @access  Private (Provider owner or Admin)
router.put('/:id', authenticateUser, [
  body('name.ar').optional().trim(),
  body('name.en').optional().trim(),
  body('description.ar').optional().trim(),
  body('description.en').optional().trim(),
  body('pricing.amount').optional().isFloat({ min: 0 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const service = await Service.findById(req.params.id);

  if (!service) {
    return res.status(404).json({
      success: false,
      message: 'Service not found'
    });
  }

  // Check ownership or admin
  const isOwner = service.provider.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  // Update service
  Object.keys(req.body).forEach(key => {
    if (req.body[key] !== undefined) {
      service[key] = req.body[key];
    }
  });

  // If provider updates, reset approval status
  if (isOwner && !isAdmin) {
    service.isApproved = false;
    service.approvedBy = null;
    service.approvedAt = null;
  }

  await service.save();

  res.json({
    success: true,
    message: 'Service updated successfully',
    data: {
      service
    }
  });
}));

// @desc    Delete service
// @route   DELETE /api/services/:id
// @access  Private (Provider owner or Admin)
router.delete('/:id', authenticateUser, asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id);

  if (!service) {
    return res.status(404).json({
      success: false,
      message: 'Service not found'
    });
  }

  // Check ownership or admin
  const isOwner = service.provider.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  // Soft delete
  service.isActive = false;
  await service.save();

  // Remove from provider's services list
  if (isOwner) {
    req.user.providerInfo.services = req.user.providerInfo.services.filter(
      id => id.toString() !== service._id.toString()
    );
    await req.user.save();
  }

  res.json({
    success: true,
    message: 'Service deleted successfully'
  });
}));

// @desc    Get provider's services
// @route   GET /api/services/provider/:providerId
// @access  Public
router.get('/provider/:providerId', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }

  const { providerId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  // Check if provider exists
  const provider = await User.findOne({ _id: providerId, role: 'provider' });
  if (!provider) {
    return res.status(404).json({
      success: false,
      message: 'Provider not found'
    });
  }

  const query = {
    provider: providerId,
    isActive: true,
    isApproved: true
  };

  const services = await Service.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await Service.countDocuments(query);

  res.json({
    success: true,
    data: {
      services,
      provider: {
        id: provider._id,
        name: provider.name,
        businessName: provider.providerInfo.businessName,
        rating: provider.providerInfo.rating
      },
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
}));

// @desc    Get service categories
// @route   GET /api/services/categories
// @access  Public
router.get('/meta/categories', asyncHandler(async (req, res) => {
  const categories = [
    {
      key: 'plumbing',
      name: { ar: 'سباكة', en: 'Plumbing' },
      icon: 'plumbing'
    },
    {
      key: 'electrical',
      name: { ar: 'كهرباء', en: 'Electrical' },
      icon: 'electrical'
    },
    {
      key: 'carpentry',
      name: { ar: 'نجارة', en: 'Carpentry' },
      icon: 'carpentry'
    },
    {
      key: 'painting',
      name: { ar: 'دهان', en: 'Painting' },
      icon: 'painting'
    },
    {
      key: 'cleaning',
      name: { ar: 'تنظيف', en: 'Cleaning' },
      icon: 'cleaning'
    },
    {
      key: 'appliance_repair',
      name: { ar: 'إصلاح الأجهزة', en: 'Appliance Repair' },
      icon: 'appliance'
    },
    {
      key: 'hvac',
      name: { ar: 'تكييف وتدفئة', en: 'HVAC' },
      icon: 'hvac'
    },
    {
      key: 'gardening',
      name: { ar: 'بستنة', en: 'Gardening' },
      icon: 'gardening'
    },
    {
      key: 'handyman',
      name: { ar: 'أعمال عامة', en: 'Handyman' },
      icon: 'handyman'
    },
    {
      key: 'pest_control',
      name: { ar: 'مكافحة الحشرات', en: 'Pest Control' },
      icon: 'pest'
    },
    {
      key: 'moving',
      name: { ar: 'نقل', en: 'Moving' },
      icon: 'moving'
    },
    {
      key: 'security',
      name: { ar: 'أمن', en: 'Security' },
      icon: 'security'
    },
    {
      key: 'other',
      name: { ar: 'أخرى', en: 'Other' },
      icon: 'other'
    }
  ];

  // Get service count for each category
  const categoriesWithCount = await Promise.all(
    categories.map(async (category) => {
      const count = await Service.countDocuments({
        category: category.key,
        isActive: true,
        isApproved: true
      });
      return { ...category, count };
    })
  );

  res.json({
    success: true,
    data: {
      categories: categoriesWithCount
    }
  });
}));

// @desc    Approve service (Admin only)
// @route   PUT /api/services/:id/approve
// @access  Private (Admin only)
router.put('/:id/approve', authenticateUser, requireRole('admin'), asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id);

  if (!service) {
    return res.status(404).json({
      success: false,
      message: 'Service not found'
    });
  }

  service.isApproved = true;
  service.approvedBy = req.user._id;
  service.approvedAt = new Date();
  await service.save();

  res.json({
    success: true,
    message: 'Service approved successfully',
    data: {
      service
    }
  });
}));

// @desc    Reject service (Admin only)
// @route   PUT /api/services/:id/reject
// @access  Private (Admin only)
router.put('/:id/reject', authenticateUser, requireRole('admin'), [
  body('reason').optional().trim()
], asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id);

  if (!service) {
    return res.status(404).json({
      success: false,
      message: 'Service not found'
    });
  }

  service.isApproved = false;
  service.isActive = false;
  await service.save();

  res.json({
    success: true,
    message: 'Service rejected successfully'
  });
}));

module.exports = router;

