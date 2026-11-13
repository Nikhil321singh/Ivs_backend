const mongoose = require('mongoose');

const { Schema } = mongoose;

const BIDDING_KYC_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

const biddingKycSchema = new Schema(
  {
    // One application per user. If rejected, the user re-submits and we
    // upsert rather than accumulate rows, keeping the history in status + reason.
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    shopAddress: {
      type: String,
      required: true,
      trim: true,
    },
    shopVisitingCardNumber: {
      type: String,
      trim: true,
    },
    googleMapLink: {
      type: String,
      trim: true,
    },
    gstNumber: {
      type: String,
      trim: true,
      uppercase: true,
    },
    // Hosted URLs for the document photos. The app sends at least one (its type
    // chosen from the dropdown); the rest stay null. "At least one" is enforced
    // in the upload middleware, not here, so a re-submission can swap one photo.
    shopVisitingCardPhotoUrl: { type: String, default: null },
    gstPhotoUrl: { type: String, default: null },
    udyamAadhaarPhotoUrl: { type: String, default: null },
    shopPhotoUrl: { type: String, default: null },
    // Storage public_ids — kept for deletion/replacement, stripped in toJSON.
    shopVisitingCardPhotoPublicId: { type: String, default: null, select: false },
    gstPhotoPublicId: { type: String, default: null, select: false },
    udyamAadhaarPhotoPublicId: { type: String, default: null, select: false },
    shopPhotoPublicId: { type: String, default: null, select: false },

    status: {
      type: String,
      enum: Object.values(BIDDING_KYC_STATUS),
      default: BIDDING_KYC_STATUS.PENDING,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

biddingKycSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.shopVisitingCardPhotoPublicId;
    delete ret.gstPhotoPublicId;
    delete ret.udyamAadhaarPhotoPublicId;
    delete ret.shopPhotoPublicId;
    return ret;
  },
});

module.exports = mongoose.model('BiddingKyc', biddingKycSchema);
module.exports.BIDDING_KYC_STATUS = BIDDING_KYC_STATUS;
