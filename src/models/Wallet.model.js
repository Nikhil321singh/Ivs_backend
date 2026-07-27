const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * One wallet per user. `balance` is a *cached* running total for fast reads —
 * the authoritative record of every movement is the append-only
 * WalletTransaction ledger, against which this balance is always
 * reconcilable. All balance changes go through services/wallet.service.js,
 * which updates this document atomically (conditional $inc) so concurrent
 * requests can never double-spend or drive the balance negative.
 */
const walletSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    // Integer tokens. 1 token = ₹1.
    balance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    // Lifetime stats (audit / analytics only — never used for spend checks).
    totalPurchased: { type: Number, default: 0 },
    totalBonus: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
  },
  { timestamps: true }
);

walletSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Wallet', walletSchema);
