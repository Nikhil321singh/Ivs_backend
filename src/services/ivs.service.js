const ImeiVerificationLog = require('../models/ImeiVerificationLog.model');
const ivsProvider = require('./providers/cdotIvsProvider');
const walletService = require('./wallet.service');
const { IVS_STATUS } = require('./providers/cdotIvsProvider');
const { hashToken } = require('../utils/hash.util');
const PRICING = require('../constants/pricing');
const { TXN_REASON, TXN_REF_TYPE } = require('../constants/walletEnums');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

// Store only the last 4 digits for display; the full Aadhaar is never
// persisted (see the model comment). Same masking as the User/KYC flow.
const maskAadhaar = (aadhaarNumber) => `XXXXXXXX${aadhaarNumber.slice(-4)}`;

// A definitive answer from CEIR — the customer paid to learn this, whether the
// device is clean or flagged. UNKNOWN/ERROR means we couldn't verify, so it's
// not billable and the customer can retry for free. Only a definitive imei1
// (and, if a second IMEI was supplied, a definitive imei2) is billable.
const DEFINITIVE = [IVS_STATUS.CLEAN, IVS_STATUS.BLOCKED, IVS_STATUS.STOLEN];
const isDefinitive = (status) => status !== null && DEFINITIVE.includes(status);
const isBillableResult = (result) =>
  isDefinitive(result.imei1Status) &&
  (result.imei2Status === null || isDefinitive(result.imei2Status));

/**
 * Debits the IVS_CHECK fee for a billable result, once. No-op (returns
 * charged:false) when the result isn't definitive. Shared by the single and
 * bulk flows so the billing rule lives in exactly one place.
 */
const chargeIfBillable = async (userId, result) => {
  const cost = PRICING.FEATURES.IVS_CHECK;
  if (!isBillableResult(result)) return { charged: false, cost };

  await walletService.debit(userId, cost, {
    reason: TXN_REASON.FEATURE_CHARGE,
    referenceType: TXN_REF_TYPE.IVS_CHECK,
    metadata: { referenceId: result.referenceId },
  });
  return { charged: true, cost };
};

/**
 * Verifies IMEI(s) against C-DOT's CEIR blocklist and logs the outcome along
 * with the customer's details captured at the point of sale. The verification
 * result is always returned to the caller even if writing the audit log fails
 * — losing the log entry shouldn't block a checkout.
 */
const verifyImei = async (userId, { imei1, imei2, deviceModel, customerName, customerMobile, aadhaarNumber }) => {
  const result = await ivsProvider.verifyImei({ imei1, imei2, deviceModel });

  try {
    await ImeiVerificationLog.create({
      userId,
      imei1,
      imei2: imei2 || null,
      deviceModel: deviceModel || null,
      customerName,
      customerMobile,
      aadhaarNumber: maskAadhaar(aadhaarNumber),
      aadhaarNumberHash: hashToken(aadhaarNumber),
      imei1Status: result.imei1Status,
      imei1CdotStatus: result.imei1CdotStatus,
      imei2Status: result.imei2Status,
      imei2CdotStatus: result.imei2CdotStatus,
      allowTransaction: result.allowTransaction,
      referenceId: result.referenceId,
      rawResponse: result.rawResponse,
      verifiedAt: new Date(result.verifiedAt),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[IVS] Failed to save verification log', result.referenceId, err.message);
  }

  return result;
};

/**
 * Bulk verification for a batch of rows parsed from a CSV (already validated
 * and capped at PRICING.IVS_BULK_MAX_ROWS by the validator). Requires enough
 * balance to cover every row up front (rows × IVS_CHECK) so a batch never
 * starts and then strands the user mid-way; non-definitive rows still aren't
 * charged, so the final spend can be lower than the reserved amount.
 */
const verifyBulk = async (userId, rows) => {
  const cost = PRICING.FEATURES.IVS_CHECK;
  const required = rows.length * cost;

  const balance = await walletService.getBalance(userId);
  if (balance < required) {
    throw new ApiError(httpStatus.PAYMENT_REQUIRED, MESSAGES.WALLET.INSUFFICIENT_BALANCE, [
      { required, balance, rows: rows.length, costPerCheck: cost },
    ]);
  }

  const results = [];
  let chargedCount = 0;

  // Sequential on purpose: shares one upstream CEIR session and keeps token
  // debits ordered/consistent rather than racing the wallet.
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const result = await verifyImei(userId, row);
    // eslint-disable-next-line no-await-in-loop
    const { charged } = await chargeIfBillable(userId, result);
    if (charged) chargedCount += 1;

    results.push({
      imei1: row.imei1,
      imei2: row.imei2 || null,
      customerName: row.customerName,
      customerMobile: row.customerMobile,
      imei1Status: result.imei1Status,
      imei2Status: result.imei2Status,
      allowTransaction: result.allowTransaction,
      referenceId: result.referenceId,
      charged,
    });
  }

  const finalBalance = await walletService.getBalance(userId);

  return {
    results,
    summary: {
      total: rows.length,
      charged: chargedCount,
      totalCharged: chargedCount * cost,
      costPerCheck: cost,
      balance: finalBalance,
    },
  };
};

/**
 * Paginated verification history for a user, newest first. Optional filters
 * let the UI look up a customer or device. The Aadhaar hash and raw provider
 * response are excluded from the list payload.
 */
const getHistory = async (userId, { page = 1, limit = 20, imei, customerMobile, aadhaarNumber, status, from, to } = {}) => {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(100, Math.max(1, limit));
  const skip = (safePage - 1) * safeLimit;

  const filter = { userId };
  if (imei) filter.$or = [{ imei1: imei }, { imei2: imei }];
  if (customerMobile) filter.customerMobile = customerMobile;
  if (aadhaarNumber) filter.aadhaarNumberHash = hashToken(aadhaarNumber);
  if (status) filter.imei1Status = status;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }

  const [items, total] = await Promise.all([
    ImeiVerificationLog.find(filter)
      .select('-aadhaarNumberHash -rawResponse')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    ImeiVerificationLog.countDocuments(filter),
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

module.exports = { verifyImei, verifyBulk, getHistory, chargeIfBillable, isBillableResult };
