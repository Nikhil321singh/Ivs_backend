const crypto = require('crypto');
const Vendor = require('../models/Vendor.model');
const VendorLicenceTransaction = require('../models/VendorLicenceTransaction.model');
const { VENDOR_TXN_TYPE, VENDOR_TXN_REASON, VENDOR_REF_TYPE } = require('../constants/vendorEnums');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/**
 * Licence ledger for third-party vendors. Same atomic pattern as
 * wallet.service.js and entitlement.service.js:
 *
 *  1. Every counter change is a conditional atomic $inc on the Vendor document
 *     so concurrent requests cannot double-spend or drive a counter negative.
 *  2. Every change writes exactly one immutable VendorLicenceTransaction row.
 *     Callers that can fire twice pass an idempotencyKey; the sparse unique index
 *     guarantees the licence moves once.
 */

const hashApiKey = (rawKey) => crypto.createHash('sha256').update(rawKey).digest('hex');

const findByApiKey = (rawKey) =>
  Vendor.findOne({ apiKeyHash: hashApiKey(rawKey) }).select('+apiKeyHash');

const findByIdempotencyKey = (idempotencyKey) =>
  idempotencyKey
    ? VendorLicenceTransaction.findOne({ idempotencyKey })
    : Promise.resolve(null);

/**
 * Grant licences to a vendor. Idempotent when idempotencyKey is supplied.
 */
const credit = async (
  vendorId,
  amount,
  {
    reason = VENDOR_TXN_REASON.ADMIN_GRANT,
    referenceType = null,
    idempotencyKey = null,
    adminId = null,
    note = null,
    metadata = null,
  } = {}
) => {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'amount must be a positive integer.');
  }

  const existing = await findByIdempotencyKey(idempotencyKey);
  if (existing) return existing;

  const vendor = await Vendor.findByIdAndUpdate(
    vendorId,
    { $inc: { licences: amount, totalGranted: amount } },
    { new: true }
  );

  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.VENDOR.NOT_FOUND);
  }

  const balanceAfter = vendor.licences;
  const balanceBefore = balanceAfter - amount;

  try {
    return await VendorLicenceTransaction.create({
      vendorId,
      type: VENDOR_TXN_TYPE.CREDIT,
      reason,
      amount,
      balanceBefore,
      balanceAfter,
      referenceType,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      adminId,
      note,
      metadata,
    });
  } catch (err) {
    if (err.code === 11000 && idempotencyKey) {
      await Vendor.findByIdAndUpdate(vendorId, {
        $inc: { licences: -amount, totalGranted: -amount },
      });
      return VendorLicenceTransaction.findOne({ idempotencyKey });
    }
    throw err;
  }
};

/**
 * Consume one licence. Throws 402 when the vendor has none left.
 * The conditional match prevents the counter ever going negative.
 */
const consume = async (
  vendorId,
  {
    idempotencyKey = null,
    metadata = null,
  } = {}
) => {
  const existing = await findByIdempotencyKey(idempotencyKey);
  if (existing) return existing;

  const vendor = await Vendor.findOneAndUpdate(
    { _id: vendorId, licences: { $gte: 1 } },
    { $inc: { licences: -1, totalUsed: 1 } },
    { new: true }
  );

  if (!vendor) {
    throw new ApiError(httpStatus.PAYMENT_REQUIRED, MESSAGES.VENDOR.NO_LICENCES);
  }

  const balanceAfter = vendor.licences;
  const balanceBefore = balanceAfter + 1;

  try {
    return await VendorLicenceTransaction.create({
      vendorId,
      type: VENDOR_TXN_TYPE.DEBIT,
      reason: VENDOR_TXN_REASON.API_CALL,
      amount: 1,
      balanceBefore,
      balanceAfter,
      referenceType: VENDOR_REF_TYPE.IVS_CHECK,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      metadata,
    });
  } catch (err) {
    // Undo the decrement so the counter and ledger stay consistent.
    await Vendor.findByIdAndUpdate(vendorId, { $inc: { licences: 1, totalUsed: -1 } });
    if (err.code === 11000 && idempotencyKey) {
      return VendorLicenceTransaction.findOne({ idempotencyKey });
    }
    throw err;
  }
};

const getLedger = async (vendorId, { page = 1, limit = 20 } = {}) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const [items, total] = await Promise.all([
    VendorLicenceTransaction.find({ vendorId }).sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
    VendorLicenceTransaction.countDocuments({ vendorId }),
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

module.exports = { hashApiKey, findByApiKey, credit, consume, getLedger };
