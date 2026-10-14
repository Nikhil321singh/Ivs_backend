const crypto = require('crypto');
const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const ivsService = require('../services/ivs.service');
const aadhaarService = require('../services/aadhaar.service');
const digilockerAadhaarService = require('../services/digilockerAadhaar.service');
const walletService = require('../services/wallet.service');
const entitlementService = require('../services/entitlement.service');
const { TXN_REASON, TXN_REF_TYPE } = require('../constants/walletEnums');
const { BILLING_SOURCE, ENTITLEMENT_REF_TYPE } = require('../constants/entitlementEnums');
const { VERIFICATION_SUBJECT } = require('../constants/aadhaarVerification');

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
 * requireFeatureAccess checks up front — a credit balance, or a token balance —
 * so a customer who cannot pay never reaches C-DOT. The charge itself runs only
 * AFTER the provider responds, and only when CEIR actually processed the lookup
 * (see isBillable). A wrong IMEI is billed, because C-DOT bills us for it; an
 * unreachable C-DOT is not. There is no refund leg at all, and no window in
 * which someone is charged for a lookup that never happened.
 *
 * Which system pays was decided by the middleware and is read from
 * `req.billingSource` — never re-derived here. Re-reading `billingMode` after
 * the C-DOT round trip would let an operator flipping the setting mid-request
 * charge a customer through a system that never approved them.
 *
 * The trade-off is deliberate and worth stating: because the balance is only
 * read before the ~1s C-DOT round trip, two checks fired concurrently by a user
 * who can afford one will both reach the provider. We pay for both calls and
 * can bill only one — the second is rejected with 402 below rather than handed
 * over free. imeiVerificationLimiter bounds how far that can be pushed.
 */
const verifyImei = asyncHandler(async (req, res) => {
  const source = req.billingSource;
  const billedInCredits = source === BILLING_SOURCE.ENTITLEMENT;

  // requireFeatureAccess already resolved the effective token price and checked
  // the wallet against it. Reuse that exact value rather than re-reading, so an
  // admin changing the price mid-request can never make us charge more than we
  // verified the user could afford. A credit-billed check has no token price.
  const cost = billedInCredits ? 0 : req.featureCost;
  const chargeRef = `IVSCHG-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  // Nothing has been taken yet, so a failure here simply propagates — there is
  // no charge to undo.
  const result = await ivsService.verifyImei(req.user.id, req.body, cost, source);

  const billable = isBillable(result);

  let charged = false;

  if (billable) {
    try {
      // Both paths are an atomic conditional decrement, so neither can drive a
      // balance negative. chargeRef goes in metadata, NOT referenceId: that
      // column is an ObjectId (it points at a Payment/Referral document), so a
      // string there throws a Mongoose cast error and surfaces as a 422 on
      // every check.
      if (billedInCredits) {
        await entitlementService.consume(req.user.id, 'IVS_CHECK', {
          referenceType: ENTITLEMENT_REF_TYPE.IVS_CHECK,
          idempotencyKey: `${chargeRef}:charge`,
          metadata: { chargeRef, verificationRef: result.referenceId },
        });
      } else {
        await walletService.debit(req.user.id, cost, {
          reason: TXN_REASON.FEATURE_CHARGE,
          referenceType: TXN_REF_TYPE.IVS_CHECK,
          idempotencyKey: `${chargeRef}:charge`,
          metadata: { feature: 'IVS_CHECK', chargeRef, verificationRef: result.referenceId },
        });
      }
      charged = true;
    } catch (err) {
      // The balance passed the check a second ago, so getting here means a
      // concurrent request spent it in between. We have already paid C-DOT for
      // this answer; withholding it is the only thing that stops the race being
      // a way to get unlimited free checks.
      // eslint-disable-next-line no-console
      console.error('[IVS] Charge failed after a billed lookup — result withheld', {
        userId: req.user.id,
        chargeRef,
        source,
        cost,
        verificationRef: result.referenceId,
        error: err.message,
      });
      throw err;
    }
  }

  const [balance, creditsRemaining] = await Promise.all([
    walletService.getBalance(req.user.id),
    entitlementService.getCredits(req.user.id, 'IVS_CHECK'),
  ]);

  successResponse(res, httpStatus.OK, MESSAGES.IVS.VERIFIED, {
    ...result,
    billing: { source, charged, cost, creditsRemaining },
    credits: { IVS_CHECK: creditsRemaining },
    // Kept for app builds that read wallet.* directly. `charged` here means
    // "tokens were taken", which is false for a credit-billed check.
    wallet: { balance, charged: charged && !billedInCredits, cost },
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

/**
 * DigiLocker equivalents of the two OTP endpoints above, and the flow the app
 * actually uses now: the seller authenticates inside their own DigiLocker, so
 * we never handle their Aadhaar number at all.
 *
 * Same contract as /user/aadhaar/digilocker/*, with one difference that matters
 * — the CUSTOMER subject keeps the result off the partner's account. The
 * partner is the operator here, not the person being verified.
 */
const startCustomerAadhaarDigilocker = asyncHandler(async (req, res) => {
  const data = await digilockerAadhaarService.startVerification(req.user.id, {
    subject: VERIFICATION_SUBJECT.CUSTOMER,
  });

  successResponse(res, httpStatus.OK, MESSAGES.IVS.CUSTOMER_DIGILOCKER_STARTED, data);
});

const getCustomerAadhaarDigilocker = asyncHandler(async (req, res) => {
  const data = await digilockerAadhaarService.getVerification(
    req.user.id,
    req.params.verificationId,
    { subject: VERIFICATION_SUBJECT.CUSTOMER }
  );

  successResponse(res, httpStatus.OK, MESSAGES.IVS.CUSTOMER_DIGILOCKER_FETCHED, data);
});

// GET /ivs/history — the caller's stored IMEI verifications (view-only, no charge).
const getHistory = asyncHandler(async (req, res) => {
  const data = await ivsService.getHistory(req.user.id, {
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
  });
  successResponse(res, httpStatus.OK, MESSAGES.IVS.HISTORY_FETCHED, data);
});

module.exports = {
  verifyImei,
  sendCustomerAadhaarOtp,
  verifyCustomerAadhaarOtp,
  startCustomerAadhaarDigilocker,
  getCustomerAadhaarDigilocker,
  getHistory,
};
