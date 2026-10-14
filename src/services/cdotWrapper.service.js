const CDOTVendor = require('../models/CDOTVendor.model');
const CDOTAPIKey = require('../models/CDOTAPIKey.model');
const CDOTCallLog = require('../models/CDOTCallLog.model');
const CDOTTransaction = require('../models/CDOTTransaction.model');
const ivsService = require('./ivs.service');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');

const CDOT_COST_PAISE = 1900; // ₹19

const validateApiKey = async (apiKey) => {
  const key = await CDOTAPIKey.findOne({ key: apiKey, isActive: true });
  if (!key) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid or inactive API key.');
  }

  const vendor = await CDOTVendor.findById(key.vendorId);
  if (!vendor || !vendor.isActive) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Vendor account is inactive.');
  }

  return { key, vendor };
};

const checkImei = async ({ apiKey, imei, ipAddress, userAgent }) => {
  const { key, vendor } = await validateApiKey(apiKey);

  if (vendor.walletBalance < CDOT_COST_PAISE) {
    const checksRemaining = Math.floor(vendor.walletBalance / CDOT_COST_PAISE);
    throw new ApiError(
      httpStatus.PAYMENT_REQUIRED,
      `Insufficient wallet balance. Need ₹19, have ₹${(vendor.walletBalance / 100).toFixed(2)}.`,
      { checksRemaining, balance: vendor.walletBalance }
    );
  }

  let result;
  try {
    result = await ivsService.verifyImei(imei);
  } catch (error) {
    throw new ApiError(
      httpStatus.BAD_GATEWAY,
      'Failed to check IMEI with C-DOT.',
      { error: error.message }
    );
  }

  const walletBefore = vendor.walletBalance;
  const walletAfter = walletBefore - CDOT_COST_PAISE;

  await CDOTCallLog.create({
    vendorId: vendor._id,
    apiKeyId: key._id,
    imei,
    result: {
      imeiStatus: result.imeiStatus,
      deviceStatus: result.deviceStatus,
      blockingReason: result.blockingReason,
      lastCheckedDate: result.checkedAt,
    },
    costPaise: CDOT_COST_PAISE,
    walletBalanceBefore: walletBefore,
    walletBalanceAfter: walletAfter,
    ipAddress,
    userAgent,
  });

  await CDOTTransaction.create({
    vendorId: vendor._id,
    type: 'DEBIT',
    amountPaise: CDOT_COST_PAISE,
    reason: 'CDOT_CHECK',
    balanceBefore: walletBefore,
    balanceAfter: walletAfter,
    reference: imei,
  });

  await CDOTVendor.findByIdAndUpdate(vendor._id, {
    walletBalance: walletAfter,
    totalApiCalls: vendor.totalApiCalls + 1,
    totalSpent: vendor.totalSpent + CDOT_COST_PAISE,
    lastActivityAt: new Date(),
  });

  await CDOTAPIKey.findByIdAndUpdate(key._id, { lastUsedAt: new Date() });

  const checksRemaining = Math.floor(walletAfter / CDOT_COST_PAISE);

  return {
    success: true,
    imeiStatus: result.imeiStatus,
    deviceStatus: result.deviceStatus,
    blockingReason: result.blockingReason,
    costDeducted: CDOT_COST_PAISE,
    walletBalance: walletAfter,
    checksRemaining,
    details: {
      imei,
      checkedAt: result.checkedAt,
    },
  };
};

module.exports = {
  checkImei,
  validateApiKey,
};
