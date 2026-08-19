const crypto = require('crypto');
const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const ivsService = require('../services/ivs.service');
const aadhaarService = require('../services/aadhaar.service');
const walletService = require('../services/wallet.service');
const { TXN_REASON, TXN_REF_TYPE } = require('../constants/walletEnums');

/**
 * Whether this check cost us a CEIR lookup, which is what decides whether the
 * user is billed.
 *
 * C-DOT charges per lookup it processes, not per useful answer. A wrong or
 * unregistered IMEI still consumes one — CEIR answers "not found" and we are
 * invoiced for it — so the user pays for that exactly as they do for CLEAN,
 * BLOCKED or STOLEN. What they never pay for is a check that never reached
 * CEIR: missing credentials, a failed login, or the service being down after
 * retries. The provider marks those with upstreamAnswered:false.
 */
const isBillable = (result) => result.upstreamAnswered === true;

/**
 * Charge on the answer, not on the attempt.
 *
 * requireBalance checks the wallet up front, so a user without funds never
 * reaches C-DOT. The debit itself runs only AFTER the provider responds, and
 * only when CEIR actually processed the lookup — see isBillable. A wrong IMEI
 * is billed, because C-DOT bills us for it; an unreachable C-DOT is not. There
 * is no refund leg at all, and no window in which someone is charged for a
 * lookup that never happened.
 *
 * The trade-off is deliberate and worth stating: because the balance is only
 * read before the ~1s C-DOT round trip, two checks fired concurrently by a user
 * who can afford one will both reach the provider. We pay for both calls and
 * can bill only one — the second is rejected with 402 below rather than handed
 * over free. imeiVerificationLimiter bounds how far that can be pushed.
 */
const verifyImei = asyncHandler(async (req, res) => {
  // requireBalance already resolved the effective price and checked the wallet
  // against it. Reuse that exact value rather than re-reading, so an admin
  // changing the price mid-request can never make us charge more than we
  // verified the user could afford.
  const cost = req.featureCost;
  const chargeRef = `IVSCHG-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  // Nothing has been taken from the wallet yet, so a failure here simply
  // propagates — there is no charge to undo.
  const result = await ivsService.verifyImei(req.user.id, req.body, cost);

  const billable = isBillable(result);

  let charged = false;

  if (billable) {
    try {
      // Atomic conditional decrement, so this still cannot drive the balance
      // negative. chargeRef goes in metadata, NOT referenceId: that column is an
      // ObjectId (it points at a Payment/Referral document), so a string there
      // throws a Mongoose cast error and surfaces as a 422 on every check.
      await walletService.debit(req.user.id, cost, {
        reason: TXN_REASON.FEATURE_CHARGE,
        referenceType: TXN_REF_TYPE.IVS_CHECK,
        idempotencyKey: `${chargeRef}:charge`,
        metadata: { feature: 'IVS_CHECK', chargeRef, verificationRef: result.referenceId },
      });
      charged = true;
    } catch (err) {
      // The balance passed the check a second ago, so getting here means a
      // concurrent request spent the tokens in between. We have already paid
      // C-DOT for this answer; withholding it is the only thing that stops the
      // race being a way to get unlimited free checks.
      // eslint-disable-next-line no-console
      console.error('[IVS] Charge failed after a billed lookup — result withheld', {
        userId: req.user.id,
        chargeRef,
        cost,
        verificationRef: result.referenceId,
        error: err.message,
      });
      throw err;
    }
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

// GET /ivs/history — the caller's stored IMEI verifications (view-only, no charge).
const getHistory = asyncHandler(async (req, res) => {
  const data = await ivsService.getHistory(req.user.id, {
    page: req.query.page,
    limit: req.query.limit,
  });
  successResponse(res, httpStatus.OK, MESSAGES.IVS.HISTORY_FETCHED, data);
});

module.exports = { verifyImei, sendCustomerAadhaarOtp, verifyCustomerAadhaarOtp, getHistory };
