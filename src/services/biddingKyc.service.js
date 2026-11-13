const BiddingKyc = require('../models/BiddingKyc.model');
const { BIDDING_KYC_STATUS } = require('../models/BiddingKyc.model');
const User = require('../models/User.model');
const uploadService = require('./upload.service');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

// The document photos the form can send, mapped to their storage suffix and the
// model columns they fill. The app sends at least one; all stay supported.
const PHOTO_FIELDS = [
  { field: 'shopVisitingCardPhoto', suffix: 'visiting-card', urlField: 'shopVisitingCardPhotoUrl', idField: 'shopVisitingCardPhotoPublicId' },
  { field: 'gstPhoto', suffix: 'gst', urlField: 'gstPhotoUrl', idField: 'gstPhotoPublicId' },
  { field: 'udyamAadhaarPhoto', suffix: 'udyam', urlField: 'udyamAadhaarPhotoUrl', idField: 'udyamAadhaarPhotoPublicId' },
  { field: 'shopPhoto', suffix: 'shop', urlField: 'shopPhotoUrl', idField: 'shopPhotoPublicId' },
];

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

  const patch = {
    shopAddress: fields.shopAddress,
    shopVisitingCardNumber: fields.shopVisitingCardNumber,
    googleMapLink: fields.googleMapLink,
    gstNumber: fields.gstNumber,
    status: BIDDING_KYC_STATUS.PENDING,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
  };

  // Upload whichever document photos were sent (the app sends at least one) and
  // set only their URL/public_id columns. Reading files[field][0] for a photo
  // the form didn't send would throw, so skip the absent ones.
  const uploaded = await Promise.all(
    PHOTO_FIELDS.filter(({ field }) => files[field]?.[0]).map(async ({ field, suffix, urlField, idField }) => {
      const asset = await uploadService.uploadBiddingKycImage(
        files[field][0].buffer,
        `${userId}-bk-${suffix}`,
        files[field][0].mimetype
      );
      return { urlField, idField, asset };
    })
  );
  uploaded.forEach(({ urlField, idField, asset }) => {
    patch[urlField] = asset.url;
    patch[idField] = asset.publicId;
  });

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
