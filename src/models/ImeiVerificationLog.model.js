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
    customerName: {
      type: String,
      trim: true,
      default: null,
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

module.exports = mongoose.model('ImeiVerificationLog', imeiVerificationLogSchema);
