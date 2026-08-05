const AadhaarOtp = require('../models/AadhaarOtp.model');
const User = require('../models/User.model');
const provider = require('./providers/aadhaarProvider');
const { hashToken } = require('../utils/hash.util');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

const AADHAAR_OTP_EXPIRY_MINUTES = 10;

const maskAadhaar = (aadhaarNumber) => `XXXXXXXX${aadhaarNumber.slice(-4)}`;

/**
 * Kicks off UIDAI e-KYC by asking the provider to send an OTP for the given
 * Aadhaar number, and stashes the provider's reference id so verifyOtp can
 * forward it back for validation.
 */
const sendAadhaarOtp = async (userId, aadhaarNumber) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUTH.USER_NOT_FOUND);
  }

  if (user.aadhaarVerified) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.USER.AADHAAR_ALREADY_VERIFIED);
  }

  const aadhaarNumberHash = hashToken(aadhaarNumber);
  const existing = await User.findOne({ aadhaarNumberHash, _id: { $ne: userId } });

  if (existing) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.USER.AADHAAR_ALREADY_EXISTS);
  }

  const { refId } = await provider.sendOtp(aadhaarNumber);
  const expiresAt = new Date(Date.now() + AADHAAR_OTP_EXPIRY_MINUTES * 60 * 1000);

  await AadhaarOtp.findOneAndUpdate(
    { userId },
    { aadhaarNumber, refId, expiresAt },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/**
 * Verifies the OTP against the provider, and on success writes a masked
 * Aadhaar number + hash (for uniqueness checks) onto the user — never the
 * full number.
 */
const verifyAadhaarOtp = async (userId, otp) => {
  const session = await AadhaarOtp.findOne({ userId });

  if (!session) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.USER.AADHAAR_OTP_SESSION_MISSING);
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.USER.AADHAAR_OTP_EXPIRED);
  }

  const { success } = await provider.verifyOtp(session.refId, otp);

  if (!success) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.USER.AADHAAR_OTP_INVALID);
  }

  const aadhaarNumberHash = hashToken(session.aadhaarNumber);
  const existing = await User.findOne({ aadhaarNumberHash, _id: { $ne: userId } });

  if (existing) {
    await AadhaarOtp.deleteOne({ _id: session._id });
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.USER.AADHAAR_ALREADY_EXISTS);
  }

  const user = await User.findByIdAndUpdate(
    userId,
    {
      aadhaarNumber: maskAadhaar(session.aadhaarNumber),
      aadhaarNumberHash,
      aadhaarVerified: true,
    },
    { new: true }
  );

  await AadhaarOtp.deleteOne({ _id: session._id });

  return user;
};

/**
 * Customer Aadhaar OTP for the IVS/IMEI flow. Unlike the account-KYC functions
 * above, this verifies a THIRD PARTY's Aadhaar (the customer selling the device),
 * so it does NOT check/require the logged-in user's aadhaarVerified state and does
 * NOT write anything onto the user. It's stateless: send-otp returns the provider
 * refId which the client passes back to verify-otp. Can be run any number of times.
 */
const sendCustomerAadhaarOtp = async (aadhaarNumber) => {
  const { refId } = await provider.sendOtp(aadhaarNumber);
  return { refId };
};

const verifyCustomerAadhaarOtp = async (refId, otp) => {
  const { success } = await provider.verifyOtp(refId, otp);

  if (!success) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.USER.AADHAAR_OTP_INVALID);
  }

  return { verified: true };
};

module.exports = {
  sendAadhaarOtp,
  verifyAadhaarOtp,
  sendCustomerAadhaarOtp,
  verifyCustomerAadhaarOtp,
};
