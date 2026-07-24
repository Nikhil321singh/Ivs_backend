const mongoose = require('mongoose');
const USER_STATUS = require('../constants/userStatus');

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
    name: {
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

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
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
