const mongoose = require('mongoose');

const { Schema } = mongoose;

const imeiVerificationLogSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    imei1: {
      type: String,
      required: true,
      trim: true,
    },
    imei2: {
      type: String,
      trim: true,
      default: null,
    },
    deviceModel: {
      type: String,
      trim: true,
      default: null,
    },
    // Customer identified at the point of verification (not the vendor).
    customerName: {
      type: String,
      trim: true,
      required: true,
    },
    customerMobile: {
      type: String,
      trim: true,
      required: true,
    },
    // Masked display value only (e.g. "XXXXXXXX1234"). The full customer
    // Aadhaar is never persisted — same privacy design as the User model.
    // `aadhaarNumberHash` allows matching/dedup without storing the number.
    aadhaarNumber: {
      type: String,
      trim: true,
      required: true,
    },
    aadhaarNumberHash: {
      type: String,
      required: true,
    },
    imei1Status: {
      type: String,
      required: true,
    },
    imei1CdotStatus: {
      type: String,
      default: null,
    },
    imei2Status: {
      type: String,
      default: null,
    },
    imei2CdotStatus: {
      type: String,
      default: null,
    },
    allowTransaction: {
      type: Boolean,
      required: true,
    },
    referenceId: {
      type: String,
      required: true,
    },
    rawResponse: {
      type: Schema.Types.Mixed,
      default: null,
    },
    verifiedAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

imeiVerificationLogSchema.index({ userId: 1, createdAt: -1 });
imeiVerificationLogSchema.index({ referenceId: 1 }, { unique: true });
// Look up a customer's verification history without storing their Aadhaar.
imeiVerificationLogSchema.index({ aadhaarNumberHash: 1 });
imeiVerificationLogSchema.index({ customerMobile: 1 });

module.exports = mongoose.model('ImeiVerificationLog', imeiVerificationLogSchema);
