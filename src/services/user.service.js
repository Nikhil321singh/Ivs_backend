const User = require('../models/User.model');
const { hashToken } = require('../utils/hash.util');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/**
 * Finds a user by mobile+countryCode, creating one if this is their first
 * login. OTP verification already happened before this is called, so the new
 * user is marked mobile-verified immediately.
 */
const findOrCreateUserByMobile = async (countryCode, mobile) => {
  let user = await User.findOne({ countryCode, mobile });
  let isNewUser = false;

  if (!user) {
    user = await User.create({
      countryCode,
      mobile,
      isMobileVerified: true,
    });
    isNewUser = true;
  } else if (!user.isMobileVerified) {
    user.isMobileVerified = true;
    await user.save();
  }

  return { user, isNewUser };
};

const getUserById = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUTH.USER_NOT_FOUND);
  }

  return user;
};

/**
 * Ensures a field value (PAN/Aadhaar/email) is not already used by a
 * different account before it is written.
 */
const assertFieldNotTaken = async (field, value, excludeUserId, conflictMessage) => {
  if (!value) return;

  const existing = await User.findOne({ [field]: value, _id: { $ne: excludeUserId } });

  if (existing) {
    throw new ApiError(httpStatus.CONFLICT, conflictMessage);
  }
};

const completeKyc = async (
  userId,
  { companyName, email, panNumber, isGstRegistered, gstNumber, aadhaarNumber },
  profileImageUrl
) => {
  const user = await getUserById(userId);

  if (user.kycCompleted) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.USER.KYC_ALREADY_COMPLETED);
  }

  if (!user.aadhaarVerified) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.USER.KYC_AADHAAR_NOT_VERIFIED);
  }

  // aadhaarNumber here is for record-keeping in the KYC submission itself —
  // the actual verification already happened via /user/aadhaar/verify-otp.
  // Confirm it's the same Aadhaar that was verified, not a different one.
  if (hashToken(aadhaarNumber) !== user.aadhaarNumberHash) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.USER.KYC_AADHAAR_MISMATCH);
  }

  await assertFieldNotTaken('email', email, userId, MESSAGES.USER.EMAIL_ALREADY_EXISTS);
  await assertFieldNotTaken('panNumber', panNumber, userId, MESSAGES.USER.PAN_ALREADY_EXISTS);
  if (isGstRegistered) {
    await assertFieldNotTaken('gstNumber', gstNumber, userId, MESSAGES.USER.GST_ALREADY_EXISTS);
  }

  user.companyName = companyName;
  user.email = email;
  user.panNumber = panNumber;
  user.isGstRegistered = isGstRegistered;
  // Leave gstNumber unset (not null) when not GST-registered — see the
  // comment on the sparse indexes in User.model.js for why.
  user.gstNumber = isGstRegistered ? gstNumber : undefined;
  user.profileImage = profileImageUrl;
  user.kycCompleted = true;

  await user.save();

  return user;
};

const updateProfile = async (userId, { name, companyName, email }, profileImageUrl) => {
  const user = await getUserById(userId);

  await assertFieldNotTaken('email', email, userId, MESSAGES.USER.EMAIL_ALREADY_EXISTS);

  if (name !== undefined) user.name = name;
  if (companyName !== undefined) user.companyName = companyName;
  if (email !== undefined) user.email = email;
  if (profileImageUrl) user.profileImage = profileImageUrl;

  await user.save();

  return user;
};

module.exports = {
  findOrCreateUserByMobile,
  getUserById,
  completeKyc,
  updateProfile,
};
