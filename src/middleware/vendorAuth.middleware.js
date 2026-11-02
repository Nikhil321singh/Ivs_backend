const asyncHandler = require('../helpers/asyncHandler');
const { findByApiKey } = require('../services/vendorLicence.service');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/**
 * Authenticates a vendor API key from the X-Api-Key header and attaches the
 * vendor document to req.vendor.
 *
 * 401 — key absent or not found in the database
 * 403 — key valid but vendor is deactivated
 * 402 — no licences remaining (checked here so the CEIR call never fires)
 */
const vendorAuth = asyncHandler(async (req, _res, next) => {
  const rawKey = req.headers['x-api-key'];

  if (!rawKey) {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.VENDOR.INVALID_API_KEY);
  }

  const vendor = await findByApiKey(rawKey);

  if (!vendor) {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.VENDOR.INVALID_API_KEY);
  }

  if (!vendor.isActive) {
    throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.VENDOR.VENDOR_INACTIVE);
  }

  if (vendor.licences < 1) {
    throw new ApiError(httpStatus.PAYMENT_REQUIRED, MESSAGES.VENDOR.NO_LICENCES);
  }

  req.vendor = vendor;
  next();
});

module.exports = vendorAuth;
