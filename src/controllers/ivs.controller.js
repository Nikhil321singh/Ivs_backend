const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const ivsService = require('../services/ivs.service');
const walletService = require('../services/wallet.service');
const PRICING = require('../constants/pricing');
const { TXN_REASON, TXN_REF_TYPE } = require('../constants/walletEnums');
const { IVS_STATUS } = require('../services/providers/cdotIvsProvider');

// A definitive answer from CEIR — the customer paid to learn this, whether the
// device is clean or flagged. UNKNOWN/ERROR means we couldn't verify, so it's
// not billable and the customer can retry for free.
const DEFINITIVE = [IVS_STATUS.CLEAN, IVS_STATUS.BLOCKED, IVS_STATUS.STOLEN];
const isDefinitive = (status) => status !== null && DEFINITIVE.includes(status);

const verifyImei = asyncHandler(async (req, res) => {
  const result = await ivsService.verifyImei(req.user.id, req.body);

  const billable =
    isDefinitive(result.imei1Status) &&
    (result.imei2Status === null || isDefinitive(result.imei2Status));

  let charged = false;
  if (billable) {
    await walletService.debit(req.user.id, PRICING.FEATURES.IVS_CHECK, {
      reason: TXN_REASON.FEATURE_CHARGE,
      referenceType: TXN_REF_TYPE.IVS_CHECK,
      metadata: { referenceId: result.referenceId },
    });
    charged = true;
  }

  const balance = await walletService.getBalance(req.user.id);

  successResponse(res, httpStatus.OK, MESSAGES.IVS.VERIFIED, {
    ...result,
    wallet: { balance, charged, cost: PRICING.FEATURES.IVS_CHECK },
  });
});

module.exports = { verifyImei };
