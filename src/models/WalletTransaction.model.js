const mongoose = require('mongoose');
const {
  TXN_TYPE,
  TXN_REASON,
  TXN_STATUS,
  TXN_REF_TYPE,
} = require('../constants/walletEnums');

const { Schema } = mongoose;

/**
 * Append-only ledger. Every credit/debit is one immutable row. `balanceBefore`
 * / `balanceAfter` snapshot the wallet around the movement for audit.
 *
 * `idempotencyKey` is the dedupe anchor for anything that can fire twice
 * (a replayed Razorpay webhook, a referral payout): a unique sparse index
 * guarantees a given key is recorded at most once. It is left *undefined*
 * (never null) when not supplied so the sparse index excludes those rows —
 * same reasoning as the sparse fields on the User model.
 */
const walletTransactionSchema = new Schema(
  {
    walletId: {
      type: Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(TXN_TYPE),
      required: true,
    },
    reason: {
      type: String,
      enum: Object.values(TXN_REASON),
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    status: {
      type: String,
      enum: Object.values(TXN_STATUS),
      default: TXN_STATUS.COMPLETED,
    },
    // Polymorphic link to whatever caused the movement.
    referenceType: {
      type: String,
      enum: [...Object.values(TXN_REF_TYPE), null],
      default: null,
    },
    referenceId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    idempotencyKey: {
      type: String,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

walletTransactionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
