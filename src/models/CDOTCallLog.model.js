const mongoose = require('mongoose');

const cdotCallLogSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CDOTVendor',
      required: true,
    },
    apiKeyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CDOTAPIKey',
      required: true,
    },
    imei: {
      type: String,
      required: true,
      trim: true,
    },
    result: {
      imeiStatus: String,  // CLEAN, BLOCKED, STOLEN
      deviceStatus: String,
      blockingReason: String,
      lastCheckedDate: Date,
    },
    costPaise: {
      type: Number,
      default: 1900,
    },
    walletBalanceBefore: {
      type: Number,
      required: true,
    },
    walletBalanceAfter: {
      type: Number,
      required: true,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

module.exports = mongoose.model('CDOTCallLog', cdotCallLogSchema);
