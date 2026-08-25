const DiagnoseSession = require('../models/DiagnoseSession.model');
const provider = require('./providers/diagnoseProvider');
const walletService = require('./wallet.service');
const settingsService = require('./settings.service');
const { TXN_REASON, TXN_REF_TYPE } = require('../constants/walletEnums');

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

module.exports = { runDiagnosis, getHistory, RESULT_STATUS };
