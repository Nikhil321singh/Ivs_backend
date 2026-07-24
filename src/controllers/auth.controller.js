const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const env = require('../config/env');
const otpService = require('../services/otp.service');
const userService = require('../services/user.service');
const tokenService = require('../services/token.service');

const sendOtp = asyncHandler(async (req, res) => {
  const { mobile, countryCode = env.defaultCountryCode } = req.body;
console.log(req.body)
  await otpService.sendOtp(countryCode, mobile);

  successResponse(res, httpStatus.OK, MESSAGES.AUTH.OTP_SENT, { mobile, countryCode });
});

const verifyOtp = asyncHandler(async (req, res) => {
  const { mobile, countryCode = env.defaultCountryCode, otp, deviceId } = req.body;

  await otpService.verifyOtp(countryCode, mobile, otp);

  const { user, isNewUser } = await userService.findOrCreateUserByMobile(countryCode, mobile);
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
  const { deviceId } = req.body;

  await tokenService.revokeRefreshToken(req.user.id, deviceId);

  successResponse(res, httpStatus.OK, MESSAGES.AUTH.LOGOUT_SUCCESS, {});
});

const getProfile = asyncHandler(async (req, res) => {
  successResponse(res, httpStatus.OK, MESSAGES.AUTH.PROFILE_FETCHED, { user: req.user });
});

module.exports = { sendOtp, verifyOtp, refreshToken, logout, getProfile };
