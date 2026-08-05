const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * Short-lived session bridging /user/aadhaar/send-otp and
 * /user/aadhaar/verify-otp. The Aadhaar number is only held here
 * transiently while authentication is in progress — once verified, only
 * a masked value + hash are written onto the User document (see
 * User.model.js) and this session is deleted.
 */
const aadhaarOtpSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    aadhaarNumber: {
      type: String,
      required: true,
      trim: true,
    },
    // Reference/transaction id returned by the e-KYC provider's send-otp
    // call, forwarded back to it on verify.
    refId: {
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

// One active Aadhaar OTP session per user — a new send-otp request replaces it.
aadhaarOtpSchema.index({ userId: 1 }, { unique: true });

// MongoDB TTL index: expired sessions are purged automatically.
aadhaarOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AadhaarOtp', aadhaarOtpSchema);
