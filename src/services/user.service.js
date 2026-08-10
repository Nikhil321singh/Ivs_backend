const User = require('../models/User.model');
const referralService = require('./referral.service');
const { hashAadhaar } = require('../utils/hash.util');
const settingsService = require('./settings.service');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const USER_TYPE = require('../constants/userType');
const USER_STATUS = require('../constants/userStatus');
const RefreshToken = require('../models/RefreshToken.model');
const AadhaarOtp = require('../models/AadhaarOtp.model');
const uploadService = require('./upload.service');

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

  // While the "KYC required" switch is off the validator lets every field
  // through empty, so assign only what was actually supplied rather than
  // writing undefined over existing values. In strict mode the validator has
  // already guaranteed presence, so these guards change nothing there.
  const kycRequired = await settingsService.isKycRequired();
  const set = (field, value) => {
    if (value !== undefined && value !== null && value !== '') user[field] = value;
  };

  await assertFieldNotTaken('email', email, userId, MESSAGES.USER.EMAIL_ALREADY_EXISTS);
  await assertFieldNotTaken('panNumber', panNumber, userId, MESSAGES.USER.PAN_ALREADY_EXISTS);

  // Falls back to individual so a body with no userType still resolves to a
  // valid shape when KYC is optional.
  const resolvedType = userType || user.userType || USER_TYPE.INDIVIDUAL;

  user.userType = resolvedType;
  set('phone', phone);
  set('email', email);
  set('panNumber', panNumber);

  if (resolvedType === USER_TYPE.VENDOR) {
    await assertFieldNotTaken('gstNumber', gstNumber, userId, MESSAGES.USER.GST_ALREADY_EXISTS);

    set('companyName', companyName);
    user.isGstRegistered = true;
    set('gstNumber', gstNumber);
    if (profileImage) {
      user.profileImage = profileImage.url;
      user.profileImagePublicId = profileImage.publicId;
    }
  } else {
    // Individual: Aadhaar must already be verified via /user/aadhaar/verify-otp.
    // The submitted aadhaarNumber is checked against that verified value
    // (never persisted in the clear) to confirm it's the same Aadhaar.
    //
    // Skipped when either switch is off: no Aadhaar means nothing to match, and
    // optional KYC cannot demand a verified Aadhaar to complete.
    if (kycRequired && (await settingsService.isAadhaarVerificationEnabled())) {
      if (!user.aadhaarVerified) {
        throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.USER.KYC_AADHAAR_NOT_VERIFIED);
      }
      if (hashAadhaar(aadhaarNumber, userId) !== user.aadhaarNumberHash) {
        throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.USER.KYC_AADHAAR_MISMATCH);
      }
    }

    set('name', name);
    user.isGstRegistered = false;
    // Leave gstNumber unset (not null) — see the sparse-index comment in
    // User.model.js for why null would collide across individuals.
    user.gstNumber = undefined;
  }

  user.kycCompleted = true;

  await user.save();

  return user;
};

/**
 * Marks onboarding done without collecting any KYC data.
 *
 * Only permitted while the "KYC required" switch is off — otherwise it would be
 * a way for any authenticated user to bypass KYC entirely, which is the one
 * thing this endpoint must not become. Writes nothing but userType and the
 * completion flag, so no partial or fabricated identity data is stored.
 */
const skipKyc = async (userId) => {
  const user = await getUserById(userId);

  if (await settingsService.isKycRequired()) {
    throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.USER.KYC_SKIP_NOT_ALLOWED);
  }

  if (user.kycCompleted) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.USER.KYC_ALREADY_COMPLETED);
  }

  user.userType = user.userType || USER_TYPE.INDIVIDUAL;
  user.isGstRegistered = false;
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

/**
 * Permanently deletes the user's account at their own request.
 *
 * Scrubs in place rather than removing the document: wallet transactions,
 * payments and IMEI verification logs all reference this userId and must be
 * retained for tax, accounting and audit. Deleting the row would orphan those
 * records; scrubbing severs the link to a person while leaving the ledger
 * intact — which is exactly what the privacy policy and deletion page promise.
 *
 * The mobile number is released (rewritten to a per-user placeholder) so the
 * unique countryCode+mobile index no longer holds it and the same person can
 * sign up again as a brand-new account.
 *
 * Deliberately NOT deleted: Wallet, WalletTransaction, Payment,
 * ImeiVerificationLog. Any remaining token balance is forfeited.
 */
const deleteAccount = async (userId) => {
  const user = await getUserById(userId);

  if (user.status === USER_STATUS.DELETED) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.USER.ACCOUNT_ALREADY_DELETED);
  }

  // Best-effort: a storage outage must not block the user's right to erasure.
  // The record is scrubbed either way; a stranded object is a cleanup job, not
  // a reason to refuse deletion.
  if (user.profileImagePublicId) {
    try {
      await uploadService.deleteProfileImage(user.profileImagePublicId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[User] Profile image delete failed during account deletion', {
        userId: String(userId),
        publicId: user.profileImagePublicId,
        error: err.message,
      });
    }
  }

  // Personal fields. Sparse-unique fields (email, panNumber, gstNumber,
  // aadhaarNumberHash, referralCode) are set to undefined, not null, so the
  // index excludes them — see the sparse-index comment in User.model.js.
  user.name = null;
  user.phone = null;
  user.companyName = null;
  user.email = undefined;
  user.panNumber = undefined;
  user.gstNumber = undefined;
  user.aadhaarNumber = null;
  user.aadhaarNumberHash = undefined;
  user.aadhaarVerified = false;
  user.profileImage = null;
  user.profileImagePublicId = null;
  user.referralCode = undefined;
  user.referredBy = null;
  user.isGstRegistered = false;
  user.userType = null;
  user.kycCompleted = false;
  user.isMobileVerified = false;

  // Release the number: keeps countryCode+mobile unique without holding the
  // real one, so re-registration creates a fresh account as the page promises.
  user.mobile = `deleted-${user._id}`;
  user.status = USER_STATUS.DELETED;
  user.deletedAt = new Date();

  await user.save();

  // Sign the user out everywhere, and drop any half-finished Aadhaar session.
  await Promise.all([
    RefreshToken.updateMany({ userId }, { isRevoked: true }),
    AadhaarOtp.deleteMany({ userId }),
  ]);

  return { deletedAt: user.deletedAt };
};

module.exports = {
  findOrCreateUserByMobile,
  getUserById,
  completeKyc,
  skipKyc,
  updateProfile,
  deleteAccount,
};
