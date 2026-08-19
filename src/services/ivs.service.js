const ImeiVerificationLog = require('../models/ImeiVerificationLog.model');
const ivsProvider = require('./providers/cdotIvsProvider');
const { IVS_STATUS } = ivsProvider;
const PRICING = require('../constants/pricing');

// A definitive CEIR answer is what the customer paid for — mirrors the billing
// rule in ivs.controller so history rows show the correct "Paid" state.
const DEFINITIVE = [IVS_STATUS.CLEAN, IVS_STATUS.BLOCKED, IVS_STATUS.STOLEN];
const isDefinitive = (status) => status !== null && DEFINITIVE.includes(status);
/**
 * Whether the user paid for a stored check.
 *
 * Reads the recorded outcome rather than re-deriving it from the status, so a
 * later change to the billing rule cannot silently re-classify old rows. The
 * status-based fallback covers rows written before `billable` existed, when a
 * definitive answer was the rule.
 */
const wasCharged = (log) => {
  if (typeof log.billable === 'boolean') return log.billable;

  return isDefinitive(log.imei1Status) && (log.imei2Status === null || isDefinitive(log.imei2Status));
};

/**
 * Verifies IMEI(s) against C-DOT's CEIR blocklist and logs the outcome.
 * The verification result is always returned to the caller even if writing
 * the audit log fails — losing the log entry shouldn't block a checkout.
 */
const verifyImei = async (userId, { imei1, imei2, deviceModel, customerName }, cost = null) => {
  const result = await ivsProvider.verifyImei({ imei1, imei2, deviceModel });

  try {
    await ImeiVerificationLog.create({
      userId,
      // Price at the moment of the check. Stored because it is now operator-
      // editable: without it, history would re-price old checks at today's
      // rate and tell a user they paid something they did not.
      cost,
      billable: result.upstreamAnswered === true,
      imei1,
      imei2: imei2 || null,
      deviceModel: deviceModel || null,
      customerName: customerName || null,
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
 * Returns the caller's stored IMEI verification history, newest first, paginated.
 * Shapes each row for the "Theft · Records" screen: identity + status + whether
 * the check was billed (so the UI can show "Paid ₹20") + the fields the
 * certificate PDF needs (imei1, deviceModel, verifiedAt).
 */
const getHistory = async (userId, { page = 1, limit = 20 } = {}) => {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const [logs, total] = await Promise.all([
    ImeiVerificationLog.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    ImeiVerificationLog.countDocuments({ userId }),
  ]);

  const items = logs.map((log) => {
    const charged = wasCharged(log);
    return {
      id: log.referenceId,
      referenceId: log.referenceId,
      customerName: log.customerName || null,
      imei1: log.imei1,
      imei2: log.imei2 || null,
      deviceModel: log.deviceModel || null,
      imei1Status: log.imei1Status,
      imei2Status: log.imei2Status || null,
      allowTransaction: log.allowTransaction,
      charged,
      // Legacy rows predate the stored cost, so fall back to the default price
      // they would have been charged at the time.
      cost: charged ? log.cost ?? PRICING.FEATURES.IVS_CHECK : 0,
      verifiedAt: log.verifiedAt,
      createdAt: log.createdAt,
    };
  });

  return {
    items,
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
};

module.exports = { verifyImei, getHistory };
