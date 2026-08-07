const asyncHandler = require('../helpers/asyncHandler');
const walletService = require('../services/wallet.service');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const PRICING = require('../constants/pricing');

/**
 * Preflight guard for a paid feature. Rejects with 402 (Payment Required)
 * BEFORE the feature runs if the wallet can't cover the cost. The actual
 * token debit happens AFTER the feature returns a billable result (in the
 * feature's own service), so a feature that ends in ERROR/UNKNOWN is never
 * charged. Must run after `authenticate` (needs req.user).
 */
const requireBalance = (featureKey) =>
  asyncHandler(async (req, res, next) => {
    const cost = PRICING.FEATURES[featureKey];
    const balance = await walletService.getBalance(req.user.id);

    if (balance < cost) {
      // Carry the actual numbers in `errors`. Without them the 402 body has no
      // balance at all, so a client reading it renders 0 and the user is told
      // they have nothing when they may have most of the cost. Enough here to
      // show "you have 10 of the 20 tokens this needs" with no extra request.
      throw new ApiError(httpStatus.PAYMENT_REQUIRED, MESSAGES.WALLET.INSUFFICIENT_BALANCE, [
        {
          field: 'balance',
          message: `This costs ${cost} tokens and your balance is ${balance}.`,
          balance,
          required: cost,
          shortfall: cost - balance,
          feature: featureKey,
        },
      ]);
    }

    req.featureKey = featureKey;
    req.featureCost = cost;
    next();
  });

module.exports = requireBalance;
