const asyncHandler = require('../helpers/asyncHandler');
const settingsService = require('../services/settings.service');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const USER_TYPE = require('../constants/userType');

/**
 * Gate for anything involving money between two users — listing a device for
 * auction, and bidding on one.
 *
 * Vendors: must have completed their standard KYC (kycCompleted: true).
 * Individuals: must have completed standard KYC AND have an approved bidding
 * KYC application (biddingKycStatus: 'approved'). Standard KYC alone is not
 * enough for individuals because bidding requires verified shop/trade identity.
 *
 * Two independent switches:
 *   - `kycRequired`        gates standard KYC (turn off if the Aadhaar provider
 *                          is down, so onboarding isn't the one blocked feature).
 *   - `biddingKycRequired` gates the individual bidding-KYC requirement on its
 *                          own, so an operator can lift or enforce bidding KYC
 *                          without forcing standard KYC on everyone.
 * Each check is skipped only when its own switch is off. Must run after
 * `authenticate`.
 */
const requireKyc = asyncHandler(async (req, res, next) => {
  const [kycRequired, biddingKycRequired] = await Promise.all([
    settingsService.isKycRequired(),
    settingsService.isBiddingKycRequired(),
  ]);

  if (kycRequired && !req.user.kycCompleted) {
    throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.AUCTION.KYC_REQUIRED, [
      { field: 'kyc', message: MESSAGES.AUCTION.KYC_REQUIRED, kycCompleted: false },
    ]);
  }

  if (
    biddingKycRequired &&
    req.user.userType === USER_TYPE.INDIVIDUAL &&
    req.user.biddingKycStatus !== 'approved'
  ) {
    throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.BIDDING_KYC.BIDDING_KYC_REQUIRED, [
      {
        field: 'biddingKyc',
        message: MESSAGES.BIDDING_KYC.BIDDING_KYC_REQUIRED,
        biddingKycStatus: req.user.biddingKycStatus,
      },
    ]);
  }

  next();
});

module.exports = requireKyc;
