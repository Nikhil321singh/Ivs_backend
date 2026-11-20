const settingsService = require('../services/settings.service');
const USER_TYPE = require('../constants/userType');

/**
 * The user object as the client should see it.
 *
 * When bidding KYC is not required (the `biddingKycRequired` switch is off), an
 * individual is effectively cleared to bid, so `biddingKycStatus` is reported as
 * 'approved'. The bidding app's gate keys on this field, so the switch unlocks
 * prices and bidding with no app release. The stored record is never changed —
 * this is a response-only view, and admin endpoints keep the real value.
 *
 * Apply this to EVERY user object the app may read into its session, so the
 * switch can never be bypassed by logging in or refreshing through a different
 * endpoint. Accepts a Mongoose doc or a already-serialized plain object.
 */
const shapeClientUser = async (userDoc) => {
  if (!userDoc) return userDoc;
  const user = userDoc.toJSON ? userDoc.toJSON() : { ...userDoc };
  if (
    user.userType === USER_TYPE.INDIVIDUAL &&
    user.biddingKycStatus !== 'approved' &&
    !(await settingsService.isBiddingKycRequired())
  ) {
    user.biddingKycStatus = 'approved';
  }
  return user;
};

module.exports = { shapeClientUser };
