const User = require('../models/User.model');
const referralService = require('./referral.service');
const { hashAadhaar } = require('../utils/hash.util');
const settingsService = require('./settings.service');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const USER_TYPE = require('../constants/userType');

/**
 * Finds a user by mobile+countryCode, creating one if this is their first
 * login. OTP verification already happened before this is called, so the new
 * user is marked mobile-verified immediately. Every new user also gets a
 * unique referral code to share.
 */
const findOrCreateUserByMobile = async (countryCode, mobile) => {
  let user = await User.findOne({ countryCode, mobile });
  let isNewUser = false;

  if (!user) {
    const referralCode = await referralService.generateUniqueReferralCode();
    user = await User.create({
      countryCode,
      mobile,
      isMobileVerified: true,
      referralCode,
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

/**
 * Completes KYC for either a vendor or an individual. The two paths diverge
 * on their identity document: a vendor is identified by GST (and submits an
 * owner image); an individual by Aadhaar (verified beforehand via OTP). Email
 * and PAN are shared. The validator guarantees the type-specific fields are
 * present before we get here.
 */
const completeKyc = async (
  userId,
  { userType, name, phone, companyName, email, panNumber, gstNumber, aadhaarNumber },
  profileImage
) => {
  const user = await getUserById(userId);

  if (user.kycCompleted) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.USER.KYC_ALREADY_COMPLETED);
  }

  await assertFieldNotTaken('email', email, userId, MESSAGES.USER.EMAIL_ALREADY_EXISTS);
  await assertFieldNotTaken('panNumber', panNumber, userId, MESSAGES.USER.PAN_ALREADY_EXISTS);

  user.userType = userType;
  user.phone = phone;
  user.email = email;
  user.panNumber = panNumber;

  if (userType === USER_TYPE.VENDOR) {
    await assertFieldNotTaken('gstNumber', gstNumber, userId, MESSAGES.USER.GST_ALREADY_EXISTS);

    user.companyName = companyName;
    user.isGstRegistered = true;
    user.gstNumber = gstNumber;
    user.profileImage = profileImage.url;
    user.profileImagePublicId = profileImage.publicId;
  } else {
    // Individual: Aadhaar must already be verified via /user/aadhaar/verify-otp.
    // The submitted aadhaarNumber is checked against that verified value
    // (never persisted in the clear) to confirm it's the same Aadhaar.
    //
    // Both checks are skipped while the admin kill switch is off — that is the
    // whole point of the switch, so KYC can complete when UIDAI is unreachable.
    if (await settingsService.isAadhaarVerificationEnabled()) {
      if (!user.aadhaarVerified) {
        throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.USER.KYC_AADHAAR_NOT_VERIFIED);
      }
      if (hashAadhaar(aadhaarNumber, userId) !== user.aadhaarNumberHash) {
        throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.USER.KYC_AADHAAR_MISMATCH);
      }
    }

    user.name = name;
    user.isGstRegistered = false;
    // Leave gstNumber unset (not null) — see the sparse-index comment in
    // User.model.js for why null would collide across individuals.
    user.gstNumber = undefined;
  }

  user.kycCompleted = true;

  await user.save();

  return user;
};

const updateProfile = async (userId, { name, companyName, email }, profileImage) => {
  const user = await getUserById(userId);

  await assertFieldNotTaken('email', email, userId, MESSAGES.USER.EMAIL_ALREADY_EXISTS);

  if (name !== undefined) user.name = name;
  if (companyName !== undefined) user.companyName = companyName;
  if (email !== undefined) user.email = email;
  if (profileImage) {
    user.profileImage = profileImage.url;
    user.profileImagePublicId = profileImage.publicId;
  }

  await user.save();

  return user;
};

module.exports = {
  findOrCreateUserByMobile,
  getUserById,
  completeKyc,
  updateProfile,
};
