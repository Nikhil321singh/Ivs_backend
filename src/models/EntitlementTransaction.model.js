const mongoose = require('mongoose');
const {
  ENTITLEMENT_TXN_TYPE,
  ENTITLEMENT_REASON,
  ENTITLEMENT_REF_TYPE,
} = require('../constants/entitlementEnums');

const { Schema } = mongoose;

/**
 * Append-only credit ledger. Every grant and every consumption is one immutable
 * row, scoped to a single feature — a Basic purchase writes two rows (one per
 * feature), not one row carrying a map, so "where did my IMEI checks go" is a
 * single-feature query.
 *
 * `balanceBefore` / `balanceAfter` snapshot that feature's counter around the
 * movement for audit.
 *
 * `idempotencyKey` is the dedupe anchor for anything that can fire twice (a
 * replayed Razorpay webhook, a retried consumption): a unique sparse index
 * guarantees a given key is recorded at most once. It is left *undefined*
 * (never null) when not supplied so the sparse index excludes those rows.
 */
const entitlementTransactionSchema = new Schema(
  {
    entitlementId: {
      type: Schema.Types.ObjectId,
      ref: 'Entitlement',
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(ENTITLEMENT_TXN_TYPE),
      required: true,
    },
    // The feature whose counter moved, e.g. IVS_CHECK.
    feature: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reason: {
      type: String,
      enum: Object.values(ENTITLEMENT_REASON),
      required: true,
    },
    // Polymorphic link to whatever caused the movement.
    referenceType: {
      type: String,
      enum: [...Object.values(ENTITLEMENT_REF_TYPE), null],
      default: null,
    },
    referenceId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    idempotencyKey: {
      type: String,
    },
    // Which admin made a manual adjustment, and why. Null for everything else.
    // There is no role separation on Admin, so this trail is the only control
    // on an operator minting free credits — see SUBSCRIPTION_DESIGN.md §8.2.
    adminId: {
      type: Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    note: {
      type: String,
      default: null,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

entitlementTransactionSchema.index({ userId: 1, createdAt: -1 });
entitlementTransactionSchema.index({ userId: 1, feature: 1, createdAt: -1 });
entitlementTransactionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

entitlementTransactionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('EntitlementTransaction', entitlementTransactionSchema);
