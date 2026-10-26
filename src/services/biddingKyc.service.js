const BiddingKyc = require('../models/BiddingKyc.model');
const { BIDDING_KYC_STATUS } = require('../models/BiddingKyc.model');
const User = require('../models/User.model');
const uploadService = require('./upload.service');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/**
 * Submit or re-submit a bidding KYC application for an individual user.
 *
 * Re-submission is allowed only when the previous attempt was rejected —
 * a pending or approved application is locked. On re-submission the old
 * photos are replaced in storage and the status resets to pending.
 */
const submitBiddingKyc = async (userId, fields, files) => {
  const existing = await BiddingKyc.findOne({ userId }).select('+shopVisitingCardPhotoPublicId +gstPhotoPublicId +udyamAadhaarPhotoPublicId +shopPhotoPublicId');

  if (existing) {
    if (existing.status === BIDDING_KYC_STATUS.PENDING) {
      throw new ApiError(httpStatus.CONFLICT, MESSAGES.BIDDING_KYC.ALREADY_PENDING);
    }
    if (existing.status === BIDDING_KYC_STATUS.APPROVED) {
      throw new ApiError(httpStatus.CONFLICT, MESSAGES.BIDDING_KYC.ALREADY_APPROVED);
    }
  }

  // Upload all four images in parallel, replacing previous assets when present.
  const [
    visitingCard,
    gstPhoto,
    udyamAadhaar,
    shopPhoto,
  ] = await Promise.all([
    uploadService.uploadBiddingKycImage(
      files.shopVisitingCardPhoto[0].buffer,
      `${userId}-bk-visiting-card`,
      files.shopVisitingCardPhoto[0].mimetype
    ),
    uploadService.uploadBiddingKycImage(
      files.gstPhoto[0].buffer,
      `${userId}-bk-gst`,
      files.gstPhoto[0].mimetype
    ),
    uploadService.uploadBiddingKycImage(
      files.udyamAadhaarPhoto[0].buffer,
      `${userId}-bk-udyam`,
      files.udyamAadhaarPhoto[0].mimetype
    ),
    uploadService.uploadBiddingKycImage(
      files.shopPhoto[0].buffer,
      `${userId}-bk-shop`,
      files.shopPhoto[0].mimetype
    ),
  ]);

  const patch = {
    shopAddress: fields.shopAddress,
    shopVisitingCardNumber: fields.shopVisitingCardNumber,
    googleMapLink: fields.googleMapLink,
    gstNumber: fields.gstNumber,
    shopVisitingCardPhotoUrl: visitingCard.url,
    shopVisitingCardPhotoPublicId: visitingCard.publicId,
    gstPhotoUrl: gstPhoto.url,
    gstPhotoPublicId: gstPhoto.publicId,
    udyamAadhaarPhotoUrl: udyamAadhaar.url,
    udyamAadhaarPhotoPublicId: udyamAadhaar.publicId,
    shopPhotoUrl: shopPhoto.url,
    shopPhotoPublicId: shopPhoto.publicId,
    status: BIDDING_KYC_STATUS.PENDING,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
  };

  let application;
  if (existing) {
    Object.assign(existing, patch);
    application = await existing.save();
  } else {
    application = await BiddingKyc.create({ userId, ...patch });
  }

  // Mirror status on the user for cheap middleware checks.
  await User.findByIdAndUpdate(userId, { biddingKycStatus: BIDDING_KYC_STATUS.PENDING });

  return application;
};

const getForUser = async (userId) => {
  const application = await BiddingKyc.findOne({ userId });
  return application;
};

module.exports = { submitBiddingKyc, getForUser };
