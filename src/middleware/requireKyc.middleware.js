const asyncHandler = require('../helpers/asyncHandler');
const settingsService = require('../services/settings.service');
const DeviceToken = require('../models/DeviceToken.model');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const USER_TYPE = require('../constants/userType');
const { DEVICE_PLATFORM } = require('../constants/notification');

/**
 * Gate for anything involving money between two users — listing a device for
 * auction, and bidding on one.
 *
 * Vendors: must have completed their standard KYC (kycCompleted: true).
 * Individuals: must have completed standard KYC AND have an approved bidding
 * KYC application (biddingKycStatus: 'approved'). Standard KYC alone is not
 * enough for individuals because bidding requires verified shop/trade identity.
 *
 * Respects the `kycRequired` kill switch. When an operator turns KYC off —
 * because the Aadhaar provider is down, say — this opens up with it, rather
 * than leaving auctions as the one feature nobody can use. Must run after
 * `authenticate`.
 */
const requireKyc = asyncHandler(async (req, res, next) => {
  const kycRequired = await settingsService.isKycRequired();

  if (!kycRequired) return next();

  if (!req.user.kycCompleted) {
    throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.AUCTION.KYC_REQUIRED, [
      { field: 'kyc', message: MESSAGES.AUCTION.KYC_REQUIRED, kycCompleted: false },
    ]);
  }

  if (req.user.userType === USER_TYPE.INDIVIDUAL) {
    if (req.user.biddingKycStatus !== 'approved' && !(await isOnIosPendingReview(req.user.id))) {
      throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.BIDDING_KYC.BIDDING_KYC_REQUIRED, [
        {
          field: 'biddingKyc',
          message: MESSAGES.BIDDING_KYC.BIDDING_KYC_REQUIRED,
          biddingKycStatus: req.user.biddingKycStatus,
        },
      ]);
    }
  }

  next();
});

/**
 * Temporary carve-out: the iOS build that can submit a bidding KYC
 * application is still in App Store review, so an individual on iOS has no
 * way to clear the check above through the app. Exempt them by their most
 * recently seen device platform until that build is live, rather than
 * dropping the requirement for everyone (Android already ships the real
 * flow). Remove once the iOS release is approved.
 *
 * Unknown platform (no registered device) does not qualify — the exemption
 * is only for a confirmed iOS client, not a default for missing data.
 */
const isOnIosPendingReview = async (userId) => {
  const latest = await DeviceToken.findOne({ userId, isActive: true })
    .sort({ lastSeenAt: -1 })
    .select('platform')
    .lean();

  return latest?.platform === DEVICE_PLATFORM.IOS;
};

module.exports = requireKyc;
