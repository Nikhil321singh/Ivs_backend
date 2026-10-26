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
      required: true,
      trim: true,
    },
    googleMapLink: {
      type: String,
      required: true,
      trim: true,
    },
    gstNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    // Hosted URLs for the four required document photos.
    shopVisitingCardPhotoUrl: { type: String, required: true },
    gstPhotoUrl: { type: String, required: true },
    udyamAadhaarPhotoUrl: { type: String, required: true },
    shopPhotoUrl: { type: String, required: true },
    // Storage public_ids — kept for deletion/replacement, stripped in toJSON.
    shopVisitingCardPhotoPublicId: { type: String, required: true, select: false },
    gstPhotoPublicId: { type: String, required: true, select: false },
    udyamAadhaarPhotoPublicId: { type: String, required: true, select: false },
    shopPhotoPublicId: { type: String, required: true, select: false },

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
