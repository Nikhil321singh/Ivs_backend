const mongoose = require('mongoose');
const DiagnoseSession = require('../models/DiagnoseSession.model');
const DiagnoseRecord = require('../models/DiagnoseRecord.model');
const provider = require('./providers/diagnoseProvider');
const walletService = require('./wallet.service');
const settingsService = require('./settings.service');
const { TXN_REASON, TXN_REF_TYPE } = require('../constants/walletEnums');
const { maskAadhaar } = require('../utils/mask.util');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

const { RESULT_STATUS, SESSION_STATUS } = DiagnoseSession;

/**
 * Runs a device diagnosis and charges the user only on a definitive success
 * — identical billing contract to IVS. If the third-party errors or is
 * unconfigured (ERROR/UNKNOWN), the attempt is logged but no tokens are
 * deducted, so the customer can retry for free.
 *
 * Preconditions: requireBalance('DIAGNOSE') has already confirmed the wallet
 * can cover the cost before this runs.
 */
const runDiagnosis = async (userId, input) => {
  const outcome = await provider.diagnose(input);
  const isBillable = outcome.resultStatus === provider.RESULT_STATUS.SUCCESS;
  // Operator-editable price, read once so the debit and the response agree.
  const cost = await settingsService.getFeatureCost('DIAGNOSE');

  let chargeTxnId = null;
  let charged = false;

  if (isBillable) {
    const txn = await walletService.debit(userId, cost, {
      reason: TXN_REASON.FEATURE_CHARGE,
      referenceType: TXN_REF_TYPE.DIAGNOSE,
      metadata: { providerRefId: outcome.providerRefId },
    });
    chargeTxnId = txn._id;
    charged = true;
  }

  const session = await DiagnoseSession.create({
    userId,
    input,
    providerRefId: outcome.providerRefId,
    resultStatus: outcome.resultStatus,
    result: outcome.result,
    rawResponse: outcome.rawResponse,
    chargeTxnId,
    status: isBillable ? SESSION_STATUS.COMPLETED : SESSION_STATUS.FAILED,
  });

  const balance = await walletService.getBalance(userId);

  return {
    sessionId: session._id,
    resultStatus: outcome.resultStatus,
    result: outcome.result,
    providerRefId: outcome.providerRefId,
    wallet: { balance, charged, cost },
  };
};

/**
 * The caller's past diagnosis sessions, newest first. View-only history for the
 * Records screen — mirrors the IVS history contract (paginated, lean).
 */
const getHistory = async (userId, { page = 1, limit = 20 } = {}) => {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const [sessions, total] = await Promise.all([
    DiagnoseSession.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
    DiagnoseSession.countDocuments({ userId }),
  ]);

  const items = sessions.map((s) => ({
    id: String(s._id),
    deviceModel: (s.input && s.input.deviceModel) || null,
    imei: (s.input && s.input.imei) || null,
    resultStatus: s.resultStatus,
    status: s.status,
    charged: !!s.chargeTxnId,
    createdAt: s.createdAt,
  }));

  return {
    items,
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
};

/* ------------------------------------------------------------------ *
 * Diagnosis records — the vendor's own bookkeeping.
 *
 * Independent of runDiagnosis above: no provider call, no token charge. The
 * vendor has already done the job and is filling in who it was for, what the
 * report said and what they billed. See models/DiagnoseRecord.model.js.
 * ------------------------------------------------------------------ */

// Escapes user input so it is matched literally inside a RegExp.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Case-insensitive $or across the fields a record row exposes, so one search
// box matches customer name, phone or email. Always combined with { userId } at
// the call site, so it only ever scans the caller's own rows. The report is
// deliberately excluded: it is free-form and can be large, and scanning it would
// turn a cheap indexed lookup into a collection scan.
const buildRecordSearchFilter = (search) => {
  const q = String(search || '').trim();
  if (!q) return null;

  const rx = new RegExp(escapeRegex(q), 'i');
  const or = [
    { customerName: rx },
    { customerPhone: rx },
    { customerEmail: rx },
    { imei: rx },
    { deviceModel: rx },
  ];

  if (/^\d+(\.\d+)?$/.test(q)) or.push({ price: Number(q) }); // search by amount

  return { $or: or };
};

const serializeRecord = (r) => ({
  id: String(r._id),
  customerName: r.customerName,
  customerPhone: r.customerPhone,
  customerEmail: r.customerEmail || null,
  // Masked at write time — the full number was never stored.
  aadhaarNumber: r.customerAadhaarNumber || null,
  imei: r.imei || null,
  deviceModel: r.deviceModel || null,
  report: r.report ?? null,
  price: r.price,
  diagnosedAt: r.diagnosedAt,
  createdAt: r.createdAt,
});

// A report may be free text or the structured output of a diagnosis tool, so
// "has one" is a content check rather than a type check. An empty string, [] or
// {} means the vendor recorded the job without findings — stored as null so
// "no report yet" is one value in the database, not four.
const hasReport = (value) => {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return false;
};

/**
 * Stores one diagnosis record for the calling vendor.
 *
 * The customer's Aadhaar is masked here, before it reaches the database, so the
 * full number exists only for the life of the request — the same rule the
 * account-holder's own Aadhaar follows in services/aadhaar.service.js.
 */
const createRecord = async (userId, payload) => {
  const {
    customerName,
    customerPhone,
    customerEmail,
    aadhaarNumber,
    imei,
    deviceModel,
    report,
    price,
    diagnosedAt,
  } = payload;

  const record = await DiagnoseRecord.create({
    userId,
    customerName,
    customerPhone,
    customerEmail: customerEmail || null,
    customerAadhaarNumber: aadhaarNumber ? maskAadhaar(aadhaarNumber) : null,
    imei: imei || null,
    deviceModel: deviceModel || null,
    report: hasReport(report) ? report : null,
    price,
    // Absent means "recorded as it happened"; the schema default would cover
    // this too, but being explicit keeps the write self-describing.
    diagnosedAt: diagnosedAt || new Date(),
  });

  return serializeRecord(record.toObject());
};

/**
 * The caller's stored records, newest diagnosis first. Sorted on diagnosedAt
 * rather than createdAt so backdated entries land in the order the work was
 * actually done, which is the order a vendor looks for them in.
 */
const getRecords = async (userId, { page = 1, limit = 20, search } = {}) => {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const searchFilter = buildRecordSearchFilter(search);
  const filter = searchFilter ? { userId, ...searchFilter } : { userId };

  const [records, total] = await Promise.all([
    DiagnoseRecord.find(filter).sort({ diagnosedAt: -1 }).skip(skip).limit(safeLimit).lean(),
    DiagnoseRecord.countDocuments(filter),
  ]);

  return {
    items: records.map(serializeRecord),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
};

/**
 * One record by id. Scoped to the caller, so another vendor's record reads as
 * "not found" rather than "forbidden" — an id from someone else's account
 * shouldn't be confirmable as real.
 */
const getRecordById = async (userId, recordId) => {
  // A malformed id would otherwise reach Mongo and surface as a 500 CastError;
  // it is a caller mistake about a record that cannot exist, so it is a 404.
  if (!mongoose.isValidObjectId(recordId)) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.DIAGNOSE.RECORD_NOT_FOUND);
  }

  const record = await DiagnoseRecord.findOne({ _id: recordId, userId }).lean();

  if (!record) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.DIAGNOSE.RECORD_NOT_FOUND);
  }

  return serializeRecord(record);
};

module.exports = {
  runDiagnosis,
  getHistory,
  createRecord,
  getRecords,
  getRecordById,
  RESULT_STATUS,
};

