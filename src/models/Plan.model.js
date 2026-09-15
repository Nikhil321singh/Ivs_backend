const mongoose = require('mongoose');
const { PLAN_TIER, PLAN_AUDIENCE } = require('../constants/entitlementEnums');

const { Schema } = mongoose;

/**
 * A credit pack SKU. These are *database rows edited from the admin portal* —
 * nothing about a pack (its quantities, price, badge, or whether it sells at
 * all) lives in constants/. A price change or a new tier is a portal edit,
 * never a deploy. See SUBSCRIPTION_DESIGN.md §8.
 *
 * The CUSTOM tier has no row here: a custom pack is priced per order from the
 * admin-set rules (minimums + discount) and snapshotted onto the Payment.
 *
 * Plans are deactivated, never deleted. Purchases already made are protected by
 * `Payment.planSnapshot` regardless, but history views still need the name to
 * resolve.
 */
const planSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    tier: {
      type: String,
      enum: Object.values(PLAN_TIER),
      required: true,
    },
    // Credits granted on purchase, keyed by feature (IVS_CHECK, DIAGNOSE, ...).
    quotas: {
      type: Map,
      of: Number,
      required: true,
    },
    // What the customer pays, in paise (matches Payment.amountPaise).
    pricePaise: {
      type: Number,
      required: true,
      min: 0,
    },
    // Strikethrough anchor. Null means "derive it from the list unit prices",
    // which keeps the displayed saving consistent with the real one.
    mrpPaise: {
      type: Number,
      default: null,
    },
    // Decoy presentation, server-controlled so pricing experiments never need
    // an app release.
    badge: {
      type: String,
      default: null,
      trim: true,
    },
    highlight: {
      type: Boolean,
      default: false,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    audience: {
      type: String,
      enum: Object.values(PLAN_AUDIENCE),
      default: PLAN_AUDIENCE.ALL,
    },
    // Credits currently never expire (product decision). Carried nullable so a
    // future validity window applies to newly-sold packs without a migration.
    validityDays: {
      type: Number,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Audit trail: who last changed this. Mirrors Setting.updatedBy.
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
  },
  { timestamps: true }
);

planSchema.index({ isActive: 1, sortOrder: 1 });

planSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Plan', planSchema);
