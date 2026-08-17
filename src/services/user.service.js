const mongoose = require('mongoose');
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
const Payment = require('../models/Payment.model');
const Wallet = require('../models/Wallet.model');
const WalletTransaction = require('../models/WalletTransaction.model');
const ImeiVerificationLog = require('../models/ImeiVerificationLog.model');
const DiagnoseSession = require('../models/DiagnoseSession.model');
const uploadService = require('./upload.service');
const { TXN_TYPE, TXN_REF_TYPE, PAYMENT_STATUS } = require('../constants/walletEnums');

/**
 * Finds a user by mobile+countryCode, creating one if this is their first
 * login. OTP verification already happened before this is called, so the new
 * user is marked mobile-verified immediately. Every new user also gets a
 * unique referral code to share.
 */
const findOrCreateUserByMobile = async (countryCode, mobile) => {
  let user = await User.findOne({ countryCode, mobile });
  let isNewUser = false;
  let isRestored = false;

  if (!user) {
    const referralCode = await referralService.generateUniqueReferralCode();
    user = await User.create({
      countryCode,
      mobile,
      isMobileVerified: true,
      referralCode,
    });
    isNewUser = true;
  } else if (user.status === USER_STATUS.DELETED) {
    // Deletion is soft: the row kept its mobile number precisely so signing in
    // again finds it. Reactivate rather than creating a second account, so the
    // wallet balance and verification history the user had are restored. The
    // personal details wiped at deletion stay gone — they re-enter them.
    user.status = USER_STATUS.ACTIVE;
    user.deletedAt = null;
    user.isMobileVerified = true;
    await user.save();
    isRestored = true;
  } else if (!user.isMobileVerified) {
    user.isMobileVerified = true;
    await user.save();
  }

  return { user, isNewUser, isRestored };
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
 * Deletes the user's account at their own request — a soft delete.
 *
 * Removes the personal details the user gave us (name, email, photo, and the
 * PAN/GST/company KYC identifiers) and signs them out everywhere, but keeps the
 * row and its mobile number so signing in again restores the same account —
 * see the DELETED branch in findOrCreateUserByMobile.
 *
 * Kept deliberately:
 *   - mobile + countryCode, so the account can be found again on login
 *   - Aadhaar verification (masked value + hash), so it need not be redone and
 *     the Aadhaar stays bound to one account
 *   - Wallet, WalletTransaction, Payment, ImeiVerificationLog — financial and
 *     audit records that must survive for tax and dispute resolution, and that
 *     reference this userId. The token balance is NOT forfeited; it is there
 *     when the user comes back.
 *
 * kycCompleted is cleared because the KYC identifiers behind it are gone, so
 * the user must resubmit KYC after restoring.
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

  // Personal fields. email/panNumber/gstNumber carry sparse-unique indexes, so
  // they are set to undefined rather than null — the index then excludes the
  // row and frees the value for anyone else (see User.model.js).
  user.name = null;
  user.phone = null;
  user.companyName = null;
  user.email = undefined;
  user.panNumber = undefined;
  user.gstNumber = undefined;
  user.profileImage = null;
  user.profileImagePublicId = null;
  user.isGstRegistered = false;
  user.kycCompleted = false;
  // Sign them out: they must re-authenticate by OTP, which is what restores
  // the account.
  user.isMobileVerified = false;

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

/**
 * Net tokens spent per paid feature, keyed by TXN_REF_TYPE (IVS_CHECK,
 * DIAGNOSE, …).
 *
 * Derived from the ledger rather than from the feature's own log, because the
 * ledger is the only place that knows what was actually *kept*: an
 * unverifiable IMEI is charged and then refunded, and both rows carry the same
 * referenceType. Netting the credits against the debits is therefore the only
 * figure that reconciles with the wallet balance — counting log rows and
 * multiplying by the price would over-report every refunded check, and the
 * price is not fixed over time either.
 */
const netSpendByFeature = async (oid) => {
  const rows = await WalletTransaction.aggregate([
    { $match: { userId: oid, referenceType: { $ne: null } } },
    {
      $group: {
        _id: { feature: '$referenceType', type: '$type' },
        total: { $sum: '$amount' },
      },
    },
  ]);

  return rows.reduce((acc, { _id, total }) => {
    const signed = _id.type === TXN_TYPE.DEBIT ? total : -total;
    acc[_id.feature] = (acc[_id.feature] || 0) + signed;
    return acc;
  }, {});
};

/**
 * Everything the app knows about one user, in a single response.
 *
 * The client's home screen otherwise needs /user/profile + /wallet/balance +
 * /referral/summary + a history call just to paint itself; this collapses them
 * into one round trip. Every section is derived from an independent collection,
 * so they are gathered concurrently and each aggregate is bounded to a single
 * grouped row rather than pulling documents into memory.
 *
 * Read-only: it never creates or mutates anything, including the wallet —
 * a user who has never transacted reports a zeroed wallet rather than having
 * one provisioned as a side effect of viewing their profile.
 */
const getUserDetails = async (userId) => {
  const user = await getUserById(userId);
  // Aggregations don't get mongoose's automatic string→ObjectId casting that
  // find()/countDocuments() do, so the match key has to be cast by hand.
  const oid = new mongoose.Types.ObjectId(String(userId));

  const [
    wallet,
    referral,
    referredBy,
    [imei = null],
    [payments = null],
    spend,
    diagnoseCount,
    lastDiagnose,
    activeSessions,
    kycRequired,
    aadhaarVerificationEnabled,
  ] = await Promise.all([
    Wallet.findOne({ userId }).lean(),
    referralService.getReferralSummary(user),
    user.referredBy
      ? User.findById(user.referredBy).select('name companyName referralCode').lean()
      : null,
    ImeiVerificationLog.aggregate([
      { $match: { userId: oid } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          allowed: { $sum: { $cond: ['$allowTransaction', 1, 0] } },
          lastAt: { $max: '$verifiedAt' },
        },
      },
    ]),
    Payment.aggregate([
      { $match: { userId: oid, status: PAYMENT_STATUS.PAID } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          amountPaise: { $sum: '$amountPaise' },
          tokens: { $sum: '$tokens' },
          lastAt: { $max: '$updatedAt' },
        },
      },
    ]),
    netSpendByFeature(oid),
    DiagnoseSession.countDocuments({ userId }),
    DiagnoseSession.findOne({ userId }).sort({ createdAt: -1 }).select('createdAt').lean(),
    RefreshToken.countDocuments({ userId, isRevoked: false, expiresAt: { $gt: new Date() } }),
    settingsService.isKycRequired(),
    settingsService.isAadhaarVerificationEnabled(),
  ]);

  return {
    user: user.toJSON(),
    kyc: {
      completed: user.kycCompleted,
      userType: user.userType,
      aadhaarVerified: user.aadhaarVerified,
      aadhaarNumber: user.aadhaarNumber, // masked value only
      panNumber: user.panNumber ?? null,
      gstNumber: user.gstNumber ?? null,
      isGstRegistered: user.isGstRegistered,
      // Mirrors the rules in completeKyc/skipKyc so the client can decide which
      // onboarding screens to show without a second call to /settings.
      kycRequired,
      aadhaarVerificationEnabled,
      canSkipKyc: !user.kycCompleted && !kycRequired,
    },
    wallet: {
      balance: wallet?.balance ?? 0,
      totalPurchased: wallet?.totalPurchased ?? 0,
      totalBonus: wallet?.totalBonus ?? 0,
      totalSpent: wallet?.totalSpent ?? 0,
    },
    referral: {
      ...referral,
      referredBy: referredBy
        ? {
            id: String(referredBy._id),
            name: referredBy.name || referredBy.companyName || null,
            referralCode: referredBy.referralCode || null,
          }
        : null,
    },
    activity: {
      imeiChecks: {
        total: imei?.total ?? 0,
        allowed: imei?.allowed ?? 0,
        blocked: (imei?.total ?? 0) - (imei?.allowed ?? 0),
        tokensSpent: spend[TXN_REF_TYPE.IVS_CHECK] ?? 0,
        lastAt: imei?.lastAt ?? null,
      },
      diagnose: {
        total: diagnoseCount,
        tokensSpent: spend[TXN_REF_TYPE.DIAGNOSE] ?? 0,
        lastAt: lastDiagnose?.createdAt ?? null,
      },
      payments: {
        totalPaid: payments?.total ?? 0,
        // Payments are stored in paise; expose rupees too so the client never
        // has to know the unit.
        amountPaise: payments?.amountPaise ?? 0,
        amountInr: (payments?.amountPaise ?? 0) / 100,
        tokensPurchased: payments?.tokens ?? 0,
        lastAt: payments?.lastAt ?? null,
      },
    },
    account: {
      status: user.status,
      isMobileVerified: user.isMobileVerified,
      activeSessions,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
    },
  };
};

module.exports = {
  findOrCreateUserByMobile,
  getUserById,
  getUserDetails,
  completeKyc,
  skipKyc,
  updateProfile,
  deleteAccount,
};
