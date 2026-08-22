const mongoose = require('mongoose');
const { VERIFICATION_STATUS, VERIFICATION_SUBJECT } = require('../constants/aadhaarVerification');

const { Schema } = mongoose;

/**
 * One DigiLocker Aadhaar verification attempt.
 *
 * The full Aadhaar number is deliberately absent. Only the masked value the
 * provider returns is stored here; the salted hash that binds an Aadhaar to one
 * account lives on the User document, exactly as the OTP flow already writes it
 * (see User.model.js and services/aadhaar.service.js).
 *
 * `refid` is the capability that secures the callback. DigiLocker redirects the
 * user's browser back to us with no bearer token, so the refid is the only
 * thing tying that request to an account — it is 16 random bytes, unique, and
 * single-use (a session in a terminal status is never re-run).
 */
const aadhaarVerificationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    refid: {
      type: String,
      required: true,
      unique: true,
    },
    // Whose identity this session proves. `userId` is always the partner who
    // opened it — for CUSTOMER sessions that is the operator, not the subject,
    // so nothing from the result is written back to their account. Defaults to
    // ACCOUNT so rows written before this field existed keep their meaning.
    subject: {
      type: String,
      enum: Object.values(VERIFICATION_SUBJECT),
      default: VERIFICATION_SUBJECT.ACCOUNT,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(VERIFICATION_STATUS),
      default: VERIFICATION_STATUS.INITIATED,
      required: true,
    },
    documentType: {
      type: String,
      default: 'AADHAAR',
    },
    // Provider-issued masked value, e.g. "XXXX-XXXX-1234". Never the full number.
    maskedAadhaar: {
      type: String,
      default: null,
    },
    name: {
      type: String,
      default: null,
    },
    dateOfBirth: {
      type: String,
      default: null,
    },
    gender: {
      type: String,
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    failureCode: {
      type: String,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
    // TTL anchor: an abandoned session disappears on its own rather than
    // lingering as a usable callback capability.
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

aadhaarVerificationSchema.index({ userId: 1, createdAt: -1 });
aadhaarVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

aadhaarVerificationSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    // The refid is a capability — it must never travel to a client.
    delete ret.refid;
    return ret;
  },
});

module.exports = mongoose.model('AadhaarVerification', aadhaarVerificationSchema);
