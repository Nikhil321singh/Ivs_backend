const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * One entitlement document per user — the credit-pack analogue of Wallet.
 *
 * `credits` is a *cached* per-feature counter set; the authoritative record of
 * every movement is the append-only EntitlementTransaction ledger, against
 * which these counters are always reconcilable. All changes go through
 * services/entitlement.service.js, which updates this document atomically
 * (conditional $inc) so concurrent requests can never double-spend a credit or
 * drive a counter negative.
 *
 * Maps are keyed by the feature keys in constants/pricing.js FEATURES
 * (IVS_CHECK, DIAGNOSE, ...), so adding a paid feature needs no schema change.
 * A key absent from `credits` means zero — a fresh account simply has no keys.
 */
const entitlementSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    // Spendable credits, per feature. Integer counts, never negative.
    credits: {
      type: Map,
      of: Number,
      default: () => new Map(),
    },
    // Lifetime stats (audit / analytics only — never used for spend checks).
    totalPurchased: {
      type: Map,
      of: Number,
      default: () => new Map(),
    },
    totalUsed: {
      type: Map,
      of: Number,
      default: () => new Map(),
    },
  },
  { timestamps: true }
);

entitlementSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Entitlement', entitlementSchema);
