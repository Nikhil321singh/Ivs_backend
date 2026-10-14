const asyncHandler = require('../helpers/asyncHandler');
const settingsService = require('../services/settings.service');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/**
 * Gate for anything involving money between two users — listing a device for
 * auction, and bidding on one.
 *
 * Auctions are the one place in this system where users transact with each
 * other rather than with us, so an anonymous account is not enough: a throwaway
 * number that can bid has no consequence for walking away, and a seller nobody
 * can identify is not a seller. `kycCompleted` is the identity signal the rest
 * of the app already collects, so this reuses it rather than inventing a second
 * notion of a trusted account.
 *
 * Respects the `kycRequired` kill switch. When an operator turns KYC off —
 * because the Aadhaar provider is down, say — this opens up with it, rather
 * than leaving auctions as the one feature nobody can use. Must run after
 * `authenticate`.
 */
const requireKyc = asyncHandler(async (req, res, next) => {
  const kycRequired = await settingsService.isKycRequired();

  if (kycRequired && !req.user.kycCompleted) {
    throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.AUCTION.KYC_REQUIRED, [
      { field: 'kyc', message: MESSAGES.AUCTION.KYC_REQUIRED, kycCompleted: false },
    ]);
  }

  next();
});

module.exports = requireKyc;
