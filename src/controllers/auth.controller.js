const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const env = require('../config/env');
const otpService = require('../services/otp.service');
const userService = require('../services/user.service');
const tokenService = require('../services/token.service');
const referralService = require('../services/referral.service');
const deviceTokenService = require('../services/deviceToken.service');

const sendOtp = asyncHandler(async (req, res) => {
  const { mobile, countryCode = env.defaultCountryCode } = req.body;

  await otpService.sendOtp(countryCode, mobile);

  successResponse(res, httpStatus.OK, MESSAGES.AUTH.OTP_SENT, { mobile, countryCode });
});

const verifyOtp = asyncHandler(async (req, res) => {
  const { mobile, countryCode = env.defaultCountryCode, otp, deviceId } = req.body;

  await otpService.verifyOtp(countryCode, mobile, otp);

  const { user, isNewUser } = await userService.findOrCreateUserByMobile(countryCode, mobile);

  // Bind a referral only for brand-new users. captureReferral is resilient —
  // an invalid/self/duplicate code is ignored so it never blocks signup.
  if (isNewUser && req.body.referralCode) {
    await referralService.captureReferral(user, req.body.referralCode);
  }

  const { accessToken, refreshToken } = await tokenService.issueTokenPair(user, deviceId);

  successResponse(
    res,
    isNewUser ? httpStatus.CREATED : httpStatus.OK,
    isNewUser ? MESSAGES.AUTH.SIGNUP_SUCCESS : MESSAGES.AUTH.LOGIN_SUCCESS,
    { user, accessToken, refreshToken }
  );
});

const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: refreshTokenPlain, deviceId } = req.body;

  const { accessToken, refreshToken: newRefreshToken } = await tokenService.rotateRefreshToken(
    refreshTokenPlain,
    deviceId
  );

  successResponse(res, httpStatus.OK, MESSAGES.AUTH.TOKEN_REFRESHED, {
    accessToken,
    refreshToken: newRefreshToken,
  });
});

const logout = asyncHandler(async (req, res) => {
  const { deviceId, fcmToken } = req.body;

  await tokenService.revokeRefreshToken(req.user.id, deviceId);

  // Retire the push registration alongside the session. Without this the
  // handset keeps receiving the signed-out user's notifications — which on a
  // shared shop device means one person's wallet and KYC alerts landing in
  // front of the next. Optional so an older client that does not send it still
  // logs out cleanly.
  if (fcmToken) {
    await deviceTokenService.deactivate(req.user.id, fcmToken);
  }

  successResponse(res, httpStatus.OK, MESSAGES.AUTH.LOGOUT_SUCCESS, {});
});

const getProfile = asyncHandler(async (req, res) => {
  successResponse(res, httpStatus.OK, MESSAGES.AUTH.PROFILE_FETCHED, { user: req.user });
});

module.exports = { sendOtp, verifyOtp, refreshToken, logout, getProfile };
