const mongoose = require('mongoose');
const USER_STATUS = require('../constants/userStatus');
const USER_TYPE = require('../constants/userType');

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    mobile: {
      type: String,
      required: true,
      trim: true,
    },
    countryCode: {
      type: String,
      required: true,
      trim: true,
    },
    // 'vendor' or 'individual', chosen at KYC. Drives which fields are
    // required and which identity document (GST vs Aadhaar) applies. Null
    // until KYC is submitted.
    userType: {
      type: String,
      enum: Object.values(USER_TYPE),
      default: null,
    },
    name: {
      type: String,
      trim: true,
      default: null,
    },
    // Contact phone number captured at KYC (both types). Distinct from
    // `mobile`, which is the OTP-verified login number — this is the
    // business/contact number supplied on the KYC form.
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    companyName: {
      type: String,
      trim: true,
      default: null,
    },
    // No `default: null` on fields below that carry a sparse unique index
    // (email, panNumber, gstNumber, aadhaarNumberHash): MongoDB's sparse
    // index only excludes documents where the field is truly absent, not
    // documents where it's explicitly null. A stored `null` default would
    // make the *second* user who signs up without e.g. a PAN collide with
    // the first on a `panNumber: null` unique-index entry. The toJSON
    // transform below backfills `null` for API responses instead.
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    panNumber: {
      type: String,
      trim: true,
      uppercase: true,
    },
    isGstRegistered: {
      type: Boolean,
      default: false,
    },
    gstNumber: {
      type: String,
      trim: true,
      uppercase: true,
    },
    // Masked display value only (e.g. "XXXXXXXX1234"). The full Aadhaar
    // number is never persisted — see aadhaarNumberHash for uniqueness
    // checks and services/aadhaar.service.js for the verification flow.
    aadhaarNumber: {
      type: String,
      trim: true,
      default: null,
    },
    aadhaarNumberHash: {
      type: String,
    },
    aadhaarVerified: {
      type: Boolean,
      default: false,
    },
    profileImage: {
      type: String,
      default: null,
    },
    // Storage provider's public_id for the profile image (the S3 object key).
    // Kept internal — used to delete/replace the asset; stripped from API
    // responses in the toJSON transform below.
    profileImagePublicId: {
      type: String,
      default: null,
      select: false,
    },
    // Vendor business proof — a photo of either a GSTIN certificate or an Udyam
    // Aadhaar, whichever the vendor uploads. businessProofType records which one.
    businessProofType: {
      type: String,
      enum: ['gstin', 'udyam'],
      default: null,
    },
    businessProofImage: {
      type: String,
      default: null,
    },
    // Storage provider's public_id for the business-proof image (see
    // profileImagePublicId above). Kept internal — stripped in the toJSON transform.
    businessProofImagePublicId: {
      type: String,
      default: null,
      select: false,
    },
    isMobileVerified: {
      type: Boolean,
      default: false,
    },
    kycCompleted: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: Object.values(USER_STATUS),
      default: USER_STATUS.ACTIVE,
    },
    // Set when the user deletes their own account. The row is kept (financial
    // and audit records point at it) but every personal field is scrubbed and
    // the mobile number is released so the person can sign up again.
    deletedAt: {
      type: Date,
      default: null,
    },
    // Every user gets a unique code at creation to share with others. Sparse
    // so any legacy row without one doesn't collide on the unique index.
    referralCode: {
      type: String,
      uppercase: true,
      trim: true,
    },
    // Who referred this user (set once, at signup, if a valid code was used).
    referredBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ countryCode: 1, mobile: 1 }, { unique: true });
userSchema.index({ panNumber: 1 }, { unique: true, sparse: true });
userSchema.index({ gstNumber: 1 }, { unique: true, sparse: true });
userSchema.index({ aadhaarNumberHash: 1 }, { unique: true, sparse: true });
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ referralCode: 1 }, { unique: true, sparse: true });

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.profileImagePublicId;
    delete ret.businessProofImagePublicId;
    // These fields intentionally have no schema default (see the sparse
    // index comment above) — normalize to null so the API response shape
    // stays consistent whether or not they've been set.
    ret.email = ret.email ?? null;
    ret.panNumber = ret.panNumber ?? null;
    ret.gstNumber = ret.gstNumber ?? null;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
