const mongoose = require('mongoose');
const crypto = require('crypto');

const cdotAPIKeySchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CDOTVendor',
      required: true,
    },
    key: {
      type: String,
      unique: true,
      default: () => `cdot_${crypto.randomBytes(24).toString('hex')}`,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CDOTAPIKey', cdotAPIKeySchema);
