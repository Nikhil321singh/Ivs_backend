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
  const profileImageUrl = uploadService.buildProfileImageUrl(req.file.filename);

  const user = await userService.completeKyc(req.user.id, req.body, profileImageUrl);

  successResponse(res, httpStatus.OK, MESSAGES.USER.KYC_COMPLETED, { user });
});

const updateProfile = asyncHandler(async (req, res) => {
  let profileImageUrl;

  if (req.file) {
    profileImageUrl = uploadService.buildProfileImageUrl(req.file.filename);
    await uploadService.deleteProfileImageByUrl(req.user.profileImage);
  }

  const user = await userService.updateProfile(req.user.id, req.body, profileImageUrl);

  successResponse(res, httpStatus.OK, MESSAGES.USER.PROFILE_UPDATED, { user });
});

const getProfile = asyncHandler(async (req, res) => {
  successResponse(res, httpStatus.OK, MESSAGES.USER.PROFILE_FETCHED, { user: req.user });
});

module.exports = { sendAadhaarOtp, verifyAadhaarOtp, completeKyc, updateProfile, getProfile };
