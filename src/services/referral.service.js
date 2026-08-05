const crypto = require('crypto');
const User = require('../models/User.model');
const Referral = require('../models/Referral.model');
const walletService = require('./wallet.service');
const PRICING = require('../constants/pricing');
const { TXN_REASON, TXN_REF_TYPE, REFERRAL_STATUS } = require('../constants/walletEnums');

/* eslint-disable no-console */

// Ambiguous characters (0/O, 1/I) omitted so codes are easy to read/share.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 7;

const randomCode = () => {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
};

/**
 * A referral code unique against the User index. Retries on the rare
 * collision, then falls back to a doubled-length code.
 */
const generateUniqueReferralCode = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    // eslint-disable-next-line no-await-in-loop
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }
  return `${randomCode()}${randomCode()}`;
};

/**
 * Binds a new user to the referrer whose code they entered. Deliberately
 * resilient: an invalid/self/duplicate code returns null instead of throwing,
 * so a bad referral code never blocks signup. Only ever call for brand-new
 * users (a referral binds once, at signup).
 */
const captureReferral = async (refereeUser, rawCode) => {
  if (!rawCode) return null;

  const code = String(rawCode).toUpperCase().trim();
  if (!code || code === refereeUser.referralCode) return null;

  const referrer = await User.findOne({ referralCode: code });
  if (!referrer || referrer._id.equals(refereeUser._id)) return null;

  try {
    const referral = await Referral.create({
      referrerId: referrer._id,
      refereeId: refereeUser._id,
      code,
    });

    refereeUser.referredBy = referrer._id;
    await refereeUser.save();

    return referral;
  } catch (err) {
    // Unique refereeId index — this user already has a referral. Ignore.
    if (err.code === 11000) return null;
    throw err;
  }
};

/**
 * Pays out a pending referral (referrer + referee welcome bonus). Called after
 * a successful top-up; safe to call on every top-up because it only pays a
 * PENDING referral and flips it to REWARDED atomically, so replays are no-ops.
 */
const maybeRewardReferral = async (refereeUserId) => {
  const claimed = await Referral.findOneAndUpdate(
    { refereeId: refereeUserId, status: REFERRAL_STATUS.PENDING },
    { status: REFERRAL_STATUS.REWARDED, rewardedAt: new Date() },
    { new: true }
  );

  if (!claimed) return null; // no pending referral, or already rewarded

  const referrerTxn = await walletService.credit(claimed.referrerId, PRICING.REFERRAL.REFERRER_BONUS, {
    reason: TXN_REASON.REFERRAL_BONUS,
    referenceType: TXN_REF_TYPE.REFERRAL,
    referenceId: claimed._id,
    idempotencyKey: `referral-referrer-${claimed._id}`,
    metadata: { refereeId: String(refereeUserId) },
  });

  const refereeTxn = await walletService.credit(refereeUserId, PRICING.REFERRAL.REFEREE_WELCOME, {
    reason: TXN_REASON.WELCOME_BONUS,
    referenceType: TXN_REF_TYPE.REFERRAL,
    referenceId: claimed._id,
    idempotencyKey: `referral-referee-${claimed._id}`,
    metadata: { referrerId: String(claimed.referrerId) },
  });

  claimed.referrerRewardTxnId = referrerTxn._id;
  claimed.refereeRewardTxnId = refereeTxn._id;
  await claimed.save();

  return claimed;
};

const getReferralSummary = async (user) => {
  const [totalReferred, totalRewarded] = await Promise.all([
    Referral.countDocuments({ referrerId: user._id }),
    Referral.countDocuments({ referrerId: user._id, status: REFERRAL_STATUS.REWARDED }),
  ]);

  return {
    referralCode: user.referralCode || null,
    totalReferred,
    totalRewarded,
    rewardPerReferral: PRICING.REFERRAL.REFERRER_BONUS,
    welcomeBonus: PRICING.REFERRAL.REFEREE_WELCOME,
  };
};

module.exports = {
  generateUniqueReferralCode,
  captureReferral,
  maybeRewardReferral,
  getReferralSummary,
};
