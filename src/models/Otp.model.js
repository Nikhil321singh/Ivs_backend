const mongoose = require('mongoose');

const { Schema } = mongoose;

const otpSchema = new Schema(
  {
    countryCode: {
      type: String,
      required: true,
      trim: true,
    },
    mobile: {
      type: String,
      required: true,
      trim: true,
    },
    otpHash: {
      // SHA-256 hash of the OTP (see utils/hash.util.js). The plaintext OTP
      // is only ever sent via SMS, never stored.
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// One active OTP per mobile number — a new send-otp request replaces it.
otpSchema.index({ countryCode: 1, mobile: 1 }, { unique: true });

// MongoDB TTL index: expired OTPs are purged automatically without a
// separate cron/worker process.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Otp', otpSchema);
