const mongoose = require('mongoose');
const { PAYMENT_STATUS } = require('../constants/walletEnums');
const { PAYMENT_PURPOSE } = require('../constants/entitlementEnums');

const { Schema } = mongoose;

/**
 * A Razorpay top-up order. Created (status CREATED) when the client asks to
 * buy tokens; flipped to PAID by the webhook (or the /verify fast-path) once
 * Razorpay confirms capture, at which point `tokens` are credited to the
 * wallet and `creditTxnId` links the resulting ledger row.
 *
 * `amountPaise` is stored in paise (Razorpay's unit) to avoid float rounding.
 *
 * `purpose` says what was bought. TOPUP is the legacy token wallet path; PLAN
 * is a credit pack, fulfilled by crediting `planSnapshot.quotas` into the user's
 * Entitlement. The default is TOPUP so every row written before credit packs
 * existed stays valid without a migration.
 */
const paymentSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    razorpayOrderId: {
      type: String,
      required: true,
      unique: true,
    },
    razorpayPaymentId: {
      type: String,
      default: null,
    },
    razorpaySignature: {
      type: String,
      default: null,
    },
    amountPaise: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    purpose: {
      type: String,
      enum: Object.values(PAYMENT_PURPOSE),
      default: PAYMENT_PURPOSE.TOPUP,
    },
    // Tokens to credit on success (amountPaise / 100 * TOKEN_PER_INR).
    // Only meaningful for TOPUP; zero on a plan purchase.
    tokens: {
      type: Number,
      default: 0,
    },
    // The catalogue plan bought. Null for a custom pack, which has no Plan row.
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'Plan',
      default: null,
    },
    // The auction being paid for. Only set when purpose is AUCTION — this is a
    // winning bidder paying the seller's price, not a purchase from us.
    auctionId: {
      type: Schema.Types.ObjectId,
      ref: 'Auction',
      default: null,
    },
    /**
     * What was actually sold, frozen at purchase time — this, never the live
     * Plan document, is what gets credited on PAID.
     *
     * Two reasons it has to be a snapshot: an admin editing a plan must not
     * retroactively change a purchase already made (same reasoning as the stored
     * `cost` on ImeiVerificationLog), and a custom pack has no plan row to read
     * back at all.
     */
    planSnapshot: {
      type: new Schema(
        {
          code: String,
          name: String,
          tier: String,
          quotas: { type: Map, of: Number },
          pricePaise: Number,
          discountPercent: Number,
        },
        { _id: false }
      ),
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.CREATED,
    },
    creditTxnId: {
      type: Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    notes: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ purpose: 1, status: 1, createdAt: -1 });
paymentSchema.index({ razorpayPaymentId: 1 }, { sparse: true });

paymentSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Payment', paymentSchema);
