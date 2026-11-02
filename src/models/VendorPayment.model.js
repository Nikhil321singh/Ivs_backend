const mongoose = require('mongoose');
const { PAYMENT_STATUS } = require('../constants/walletEnums');

const { Schema } = mongoose;

/**
 * A Razorpay order raised by a vendor to buy IMEI-check licences.
 *
 * Kept separate from the user Payment model: vendor payments have no userId,
 * no wallet, no entitlement — just licences. Same CREATED→PAID lifecycle and
 * the same idempotent creditForPayment pattern as user payments.
 */
const vendorPaymentSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, default: null },
    razorpaySignature: { type: String, default: null },
    amountPaise: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    licences: { type: Number, required: true },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.CREATED,
    },
    notes: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

vendorPaymentSchema.index({ vendorId: 1, createdAt: -1 });
vendorPaymentSchema.index({ razorpayPaymentId: 1 }, { sparse: true });

vendorPaymentSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('VendorPayment', vendorPaymentSchema);
