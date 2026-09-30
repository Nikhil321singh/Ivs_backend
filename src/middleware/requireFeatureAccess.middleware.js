const asyncHandler = require('../helpers/asyncHandler');
const requireBalance = require('./requireBalance.middleware');
const entitlementService = require('../services/entitlement.service');
const settingsService = require('../services/settings.service');
const { SETTING_KEYS } = require('../constants/settings');
const { BILLING_MODE, BILLING_SOURCE } = require('../constants/entitlementEnums');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/**
 * Preflight guard for a paid feature, across both billing systems.
 *
 * Rejects with 402 (Payment Required) BEFORE the feature runs if the customer
 * can't pay for it. The actual charge — one credit, or a token debit — happens
 * AFTER the feature returns a billable result, so a run that ends in
 * ERROR/UNKNOWN is never charged. Must run after `authenticate`.
 *
 * Which system pays is the operator's call at runtime (`billingMode`):
 *
 *   SUBSCRIPTION  credits only — the current product
 *   WALLET        tokens only — the pre-subscription behaviour, unchanged
 *   BOTH          credits first, tokens as fallback — the cutover mode, so
 *                 customers holding tokens drain them instead of stranding
 *
 * It sets `req.billingSource` to whichever system approved the request, and the
 * feature's charge point MUST honour that rather than re-deciding: re-reading
 * the mode after the provider call would let a setting changed mid-request
 * charge a customer through a system that never approved them.
 */
const requireFeatureAccess = (featureKey) =>
  asyncHandler(async (req, res, next) => {
    const mode = await settingsService.get(SETTING_KEYS.BILLING_MODE);

    if (mode !== BILLING_MODE.WALLET) {
      const credits = await entitlementService.getCredits(req.user.id, featureKey);

      if (credits >= 1) {
        req.featureKey = featureKey;
        req.billingSource = BILLING_SOURCE.ENTITLEMENT;
        req.featureCredits = credits;
        return next();
      }

      if (mode === BILLING_MODE.SUBSCRIPTION) {
        // Carry the actual numbers in `errors`, for the same reason the wallet
        // guard does: enough here for the app to render "0 IMEI checks left"
        // and a buy button with no extra request.
        throw new ApiError(httpStatus.PAYMENT_REQUIRED, MESSAGES.ENTITLEMENT.NO_CREDITS, [
          {
            field: 'credits',
            message: `You have no ${featureKey} credits left.`,
            feature: featureKey,
            remaining: credits,
            required: 1,
          },
        ]);
      }
      // BOTH, and no credits — fall through to the wallet.
    }

    // Delegate to the token guard so the 402 body, the price resolution and the
    // `req.featureCost` contract stay in exactly one place. Its `next` is
    // wrapped only to record which system approved the request.
    return requireBalance(featureKey)(req, res, (err) => {
      if (err) return next(err);
      req.billingSource = BILLING_SOURCE.WALLET;
      return next();
    });
  });

module.exports = requireFeatureAccess;
