const crypto = require('crypto');
const Vendor = require('../../models/Vendor.model');
const vendorLicenceService = require('../../services/vendorLicence.service');
const ApiError = require('../../utils/apiError');
const httpStatus = require('../../constants/httpStatus');
const MESSAGES = require('../../constants/messages');
const { VENDOR_TXN_REASON } = require('../../constants/vendorEnums');

/**
 * Generates a cryptographically random API key (hex, 64 chars = 32 bytes).
 * The raw value is returned once and never stored; only its SHA-256 hash is
 * persisted in the Vendor document.
 */
const generateApiKey = () => crypto.randomBytes(32).toString('hex');

const createVendor = async ({ name, email }) => {
  const rawKey = generateApiKey();
  const apiKeyHash = vendorLicenceService.hashApiKey(rawKey);

  const vendor = await Vendor.create({ name, email, apiKeyHash });

  // Return the plain key alongside the vendor — this is the only time it is
  // visible. The caller must relay it to the vendor; it cannot be recovered later.
  return { vendor, apiKey: rawKey };
};

const listVendors = async ({ page = 1, limit = 20 } = {}) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const [items, total] = await Promise.all([
    Vendor.find().sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
    Vendor.countDocuments(),
  ]);

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
    },
  };
};

const getVendor = async (vendorId) => {
  const vendor = await Vendor.findById(vendorId);

  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.VENDOR.NOT_FOUND);
  }

  return { vendor };
};

const updateVendor = async (vendorId, { name, email, isActive }) => {
  const update = {};
  if (name !== undefined) update.name = name;
  if (email !== undefined) update.email = email;
  if (isActive !== undefined) update.isActive = isActive;

  const vendor = await Vendor.findByIdAndUpdate(vendorId, update, { new: true });

  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.VENDOR.NOT_FOUND);
  }

  return { vendor };
};

const grantLicences = async (vendorId, amount, { adminId, note }) => {
  const vendor = await Vendor.findById(vendorId);

  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.VENDOR.NOT_FOUND);
  }

  await vendorLicenceService.credit(vendorId, amount, {
    reason: VENDOR_TXN_REASON.ADMIN_GRANT,
    adminId,
    note,
  });

  const updated = await Vendor.findById(vendorId);
  return { vendor: updated };
};

const getLedger = async (vendorId, { page, limit } = {}) => {
  const vendor = await Vendor.findById(vendorId);

  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.VENDOR.NOT_FOUND);
  }

  return vendorLicenceService.getLedger(vendorId, { page, limit });
};

module.exports = { createVendor, listVendors, getVendor, updateVendor, grantLicences, getLedger };
