const mongoose = require('mongoose');
const { REFERRAL_STATUS } = require('../constants/walletEnums');

const { Schema } = mongoose;

/**
 * Records that `refereeId` signed up using `referrerId`'s code. One per
 * referred user (unique `refereeId`). Stays PENDING until the referee makes
 * their first paid top-up, at which point referralService pays both sides and
 * flips it to REWARDED — the reward ledger rows are linked back here.
 */
const referralSchema = new Schema(
  {
    referrerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    refereeId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    code: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(REFERRAL_STATUS),
      default: REFERRAL_STATUS.PENDING,
    },
    referrerRewardTxnId: {
      type: Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    refereeRewardTxnId: {
      type: Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    rewardedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

referralSchema.index({ referrerId: 1, createdAt: -1 });

referralSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Referral', referralSchema);
