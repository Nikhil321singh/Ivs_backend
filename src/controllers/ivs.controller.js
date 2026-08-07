const crypto = require('crypto');
const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const ivsService = require('../services/ivs.service');
const aadhaarService = require('../services/aadhaar.service');
const walletService = require('../services/wallet.service');
const PRICING = require('../constants/pricing');
const { TXN_REASON, TXN_REF_TYPE } = require('../constants/walletEnums');
const { IVS_STATUS } = require('../services/providers/cdotIvsProvider');

// A definitive answer from CEIR — the customer paid to learn this, whether the
// device is clean or flagged. UNKNOWN/ERROR means we couldn't verify, so it's
// not billable and the customer can retry for free.
const DEFINITIVE = [IVS_STATUS.CLEAN, IVS_STATUS.BLOCKED, IVS_STATUS.STOLEN];
const isDefinitive = (status) => status !== null && DEFINITIVE.includes(status);

/**
 * Charge up front, refund if CEIR gave us no usable answer.
 *
 * The debit runs BEFORE the C-DOT call on purpose. requireBalance only *reads*
 * the balance, and the C-DOT round trip takes ~1s, so charging afterwards left
 * a window where two concurrent checks both passed the balance test and both
 * debited — overdrawing the wallet. debit() is an atomic conditional decrement,
 * so taking the tokens first closes that window.
 *
 * The user still only pays for a definitive answer: any UNKNOWN/ERROR (C-DOT
 * unreachable, auth failure, not configured), or a thrown error, refunds the
 * full cost. Both legs carry an idempotency key derived from one charge
 * reference, so a retry can never double-charge or double-refund.
 */
const verifyImei = asyncHandler(async (req, res) => {
  const cost = PRICING.FEATURES.IVS_CHECK;
  const chargeRef = `IVSCHG-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  await walletService.debit(req.user.id, cost, {
    reason: TXN_REASON.FEATURE_CHARGE,
    referenceType: TXN_REF_TYPE.IVS_CHECK,
    referenceId: chargeRef,
    idempotencyKey: `${chargeRef}:charge`,
    metadata: { feature: 'IVS_CHECK' },
  });

  // Never let a refund failure mask the verification outcome — the tokens are
  // already gone, so log loudly with everything needed to correct it by hand
  // and report charged:true, which is what actually happened to the balance.
  const refund = async (cause, referenceId) => {
    try {
      await walletService.credit(req.user.id, cost, {
        reason: TXN_REASON.REFUND,
        referenceType: TXN_REF_TYPE.IVS_CHECK,
        referenceId: referenceId || chargeRef,
        idempotencyKey: `${chargeRef}:refund`,
        metadata: { chargeRef, cause },
      });
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[IVS] REFUND FAILED — user charged without a result', {
        userId: req.user.id,
        chargeRef,
        cost,
        cause,
        error: err.message,
      });
      return false;
    }
  };

  let result;
  try {
    result = await ivsService.verifyImei(req.user.id, req.body);
  } catch (err) {
    await refund('verification_threw', null);
    throw err;
  }

  const billable =
    isDefinitive(result.imei1Status) &&
    (result.imei2Status === null || isDefinitive(result.imei2Status));

  let charged = true;
  if (!billable) {
    const refunded = await refund('no_definitive_result', result.referenceId);
    charged = !refunded;
  }

  const balance = await walletService.getBalance(req.user.id);

  successResponse(res, httpStatus.OK, MESSAGES.IVS.VERIFIED, {
    ...result,
    wallet: { balance, charged, cost },
  });
});

// Customer Aadhaar OTP for the IMEI flow — verifies the device seller's Aadhaar
// (a third party), independent of the logged-in user's own KYC. Stateless: the
// refId from send-otp is returned to the client and passed back to verify-otp.
const sendCustomerAadhaarOtp = asyncHandler(async (req, res) => {
  const data = await aadhaarService.sendCustomerAadhaarOtp(req.body.aadhaarNumber);
  successResponse(res, httpStatus.OK, MESSAGES.USER.AADHAAR_OTP_SENT, data);
});

const verifyCustomerAadhaarOtp = asyncHandler(async (req, res) => {
  const data = await aadhaarService.verifyCustomerAadhaarOtp(req.body.refId, req.body.otp);
  successResponse(res, httpStatus.OK, MESSAGES.USER.AADHAAR_VERIFIED, data);
});

module.exports = { verifyImei, sendCustomerAadhaarOtp, verifyCustomerAadhaarOtp };
