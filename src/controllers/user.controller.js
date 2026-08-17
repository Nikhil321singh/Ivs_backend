const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const userService = require('../services/user.service');
const uploadService = require('../services/upload.service');
const aadhaarService = require('../services/aadhaar.service');

const sendAadhaarOtp = asyncHandler(async (req, res) => {
  await aadhaarService.sendAadhaarOtp(req.user.id, req.body.aadhaarNumber);

  successResponse(res, httpStatus.OK, MESSAGES.USER.AADHAAR_OTP_SENT, {});
});

const verifyAadhaarOtp = asyncHandler(async (req, res) => {
  const user = await aadhaarService.verifyAadhaarOtp(req.user.id, req.body.otp);

  successResponse(res, httpStatus.OK, MESSAGES.USER.AADHAAR_VERIFIED, { user });
});

const completeKyc = asyncHandler(async (req, res) => {
  // Only vendors submit an owner image; individuals have no image. The
  // validator has already enforced its presence for vendors.
  let profileImage;
  if (req.file) {
    profileImage = await uploadService.uploadProfileImage(req.file.buffer, req.user.id);
  }

  const user = await userService.completeKyc(req.user.id, req.body, profileImage);

  successResponse(res, httpStatus.OK, MESSAGES.USER.KYC_COMPLETED, { user });
});

const skipKyc = asyncHandler(async (req, res) => {
  const user = await userService.skipKyc(req.user.id);

  successResponse(res, httpStatus.OK, MESSAGES.USER.KYC_SKIPPED, { user });
});

const deleteAccount = asyncHandler(async (req, res) => {
  const data = await userService.deleteAccount(req.user.id);

  successResponse(res, httpStatus.OK, MESSAGES.USER.ACCOUNT_DELETED, data);
});

const updateProfile = asyncHandler(async (req, res) => {
  let profileImage;

  // A re-upload uses the same deterministic public_id, so it overwrites the
  // existing asset in place — no separate delete of the old image needed.
  if (req.file) {
    profileImage = await uploadService.uploadProfileImage(req.file.buffer, req.user.id);
  }

  const user = await userService.updateProfile(req.user.id, req.body, profileImage);

  successResponse(res, httpStatus.OK, MESSAGES.USER.PROFILE_UPDATED, { user });
});

const getProfile = asyncHandler(async (req, res) => {
  successResponse(res, httpStatus.OK, MESSAGES.USER.PROFILE_FETCHED, { user: req.user });
});

const getUserDetails = asyncHandler(async (req, res) => {
  const details = await userService.getUserDetails(req.user.id);

  successResponse(res, httpStatus.OK, MESSAGES.USER.DETAILS_FETCHED, details);
});

module.exports = {
  sendAadhaarOtp,
  verifyAadhaarOtp,
  completeKyc,
  skipKyc,
  updateProfile,
  getProfile,
  getUserDetails,
  deleteAccount,
};
