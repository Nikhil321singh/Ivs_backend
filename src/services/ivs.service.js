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

// Escapes user input so it is matched literally inside a RegExp.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Builds a case-insensitive $or across every text/identity field a history row
// exposes, so a single search box matches reference id, customer name, device
// model, IMEI or CEIR status. IMEIs are stored as raw digits, so a query typed
// with spaces/dashes is reduced to digits before matching; a whole-number query
// also matches the charged amount. Always combined with { userId } at the call
// site, so it only ever scans the caller's own (small) set of rows.
const buildSearchFilter = (search) => {
  const q = String(search || '').trim();
  if (!q) return null;

  const rx = new RegExp(escapeRegex(q), 'i');
  const or = [
    { referenceId: rx },
    { customerName: rx },
    { deviceModel: rx },
    { imei1Status: rx },
    { imei2Status: rx },
  ];

  const digits = q.replace(/\D/g, '');
  if (digits) {
    const drx = new RegExp(escapeRegex(digits), 'i');
    or.push({ imei1: drx }, { imei2: drx });
    if (/^\d+$/.test(q)) or.push({ cost: Number(q) }); // search by amount
  }

  return { $or: or };
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
const getHistory = async (userId, { page = 1, limit = 20, search } = {}) => {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  // userId first (uses the { userId, createdAt } index), then the optional
  // full-text-ish search as a residual filter over just this user's rows.
  const searchFilter = buildSearchFilter(search);
  const filter = searchFilter ? { userId, ...searchFilter } : { userId };

  const [logs, total] = await Promise.all([
    ImeiVerificationLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    ImeiVerificationLog.countDocuments(filter),
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
