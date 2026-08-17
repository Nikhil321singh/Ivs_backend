const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * Failed OTP verification counter, per mobile number.
 *
 * Deliberately a separate collection from Otp rather than a field on it: the
 * Otp document is replaced on every send-otp, so a counter living there would
 * reset the moment an attacker requested a fresh code — which is exactly the
 * move a brute-force attempt makes. Keyed on the number instead, the lockout
 * survives new OTPs.
 *
 * This is the per-ACCOUNT limit. The per-IP limiter in rateLimiter.middleware
 * is separate and complementary: that one stops one host guessing many numbers,
 * this one stops many hosts guessing one number.
 *
 * The TTL index expires the row when the window ends, so a lockout lifts
 * automatically with no cleanup job.
 */
const otpAttemptSchema = new Schema(
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
    count: {
      type: Number,
      required: true,
      default: 0,
    },
    // When the current window ends. MongoDB removes the row at this time.
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

otpAttemptSchema.index({ countryCode: 1, mobile: 1 }, { unique: true });
otpAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpAttempt', otpAttemptSchema);
