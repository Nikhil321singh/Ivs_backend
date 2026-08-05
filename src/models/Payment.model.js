const mongoose = require('mongoose');
const { PAYMENT_STATUS } = require('../constants/walletEnums');

const { Schema } = mongoose;

/**
 * A Razorpay top-up order. Created (status CREATED) when the client asks to
 * buy tokens; flipped to PAID by the webhook (or the /verify fast-path) once
 * Razorpay confirms capture, at which point `tokens` are credited to the
 * wallet and `creditTxnId` links the resulting ledger row.
 *
 * `amountPaise` is stored in paise (Razorpay's unit) to avoid float rounding.
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
    // Tokens to credit on success (amountPaise / 100 * TOKEN_PER_INR).
    tokens: {
      type: Number,
      required: true,
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
