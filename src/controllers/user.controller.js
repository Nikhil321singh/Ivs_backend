const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const userService = require('../services/user.service');
const uploadService = require('../services/upload.service');
const aadhaarService = require('../services/aadhaar.service');
const digilockerAadhaarService = require('../services/digilockerAadhaar.service');
const env = require('../config/env');

const sendAadhaarOtp = asyncHandler(async (req, res) => {
  await aadhaarService.sendAadhaarOtp(req.user.id, req.body.aadhaarNumber);

  successResponse(res, httpStatus.OK, MESSAGES.USER.AADHAAR_OTP_SENT, {});
});

const verifyAadhaarOtp = asyncHandler(async (req, res) => {
  const user = await aadhaarService.verifyAadhaarOtp(req.user.id, req.body.otp);

  successResponse(res, httpStatus.OK, MESSAGES.USER.AADHAAR_VERIFIED, { user });
});

const completeKyc = asyncHandler(async (req, res) => {
  // Only vendors submit images: an owner photo (profileImage) and an optional
  // business-proof photo (businessProofImage — GSTIN or Udyam Aadhaar). multer
  // .fields() puts each under req.files[field][0]; individuals send neither.
  const profileFile = req.files?.profileImage?.[0];
  const proofFile = req.files?.businessProofImage?.[0];

  let profileImage;
  if (profileFile) {
    profileImage = await uploadService.uploadProfileImage(
      profileFile.buffer,
      req.user.id,
      profileFile.mimetype
    );
  }

  let businessProofImage;
  if (proofFile) {
    businessProofImage = await uploadService.uploadBusinessProofImage(
      proofFile.buffer,
      req.user.id,
      proofFile.mimetype
    );
  }

  const user = await userService.completeKyc(req.user.id, req.body, {
    profileImage,
    businessProofImage,
  });

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
    profileImage = await uploadService.uploadProfileImage(
      req.file.buffer,
      req.user.id,
      req.file.mimetype
    );
  }

  const user = await userService.updateProfile(req.user.id, req.body, profileImage);

  successResponse(res, httpStatus.OK, MESSAGES.USER.PROFILE_UPDATED, { user });
});

const getProfile = asyncHandler(async (req, res) => {
  successResponse(res, httpStatus.OK, MESSAGES.USER.PROFILE_FETCHED, { user: req.user });
});

const startDigilockerAadhaar = asyncHandler(async (req, res) => {
  const data = await digilockerAadhaarService.startVerification(req.user.id);

  successResponse(res, httpStatus.OK, MESSAGES.USER.DIGILOCKER_STARTED, data);
});

/**
 * DigiLocker sends the user's browser here, so this is a redirect endpoint, not
 * a JSON one — and it is unauthenticated, because the request comes from
 * DigiLocker rather than from our app. The refid is the only credential.
 *
 * Only the verification id travels back in the URL: putting a result (let alone
 * Aadhaar details) in a query string would leak it into browser history, the
 * referrer header and any intermediary's logs. The app reads the outcome from
 * the authenticated status endpoint.
 */
const digilockerAadhaarCallback = asyncHandler(async (req, res) => {
  // refid arrives primarily as a path segment (see startVerification). The query
  // is only a backup and may be duplicated by the provider — take the first value
  // if Express parsed it into an array.
  const first = (v) => (Array.isArray(v) ? v.find(Boolean) : v);
  const refid =
    req.params.refid || first(req.query.refid) || first(req.query.ref_id) || first(req.body?.refid);

  // This endpoint is shown to the user's browser, so it must never render raw JSON
  // (a lost refid or unknown session would otherwise dump an error page into the
  // DigiLocker tab). Always bounce back to the app; its status poll surfaces the
  // real outcome. If no return URL is configured, fall back to a plain message.
  const returnToApp = (params) => {
    if (!env.digilocker.appReturnUrl) {
      return res.status(200).send('Verification received. You can return to the app.');
    }
    const target = new URL(env.digilocker.appReturnUrl);
    Object.entries(params).forEach(([k, v]) => target.searchParams.set(k, v));
    return res.redirect(302, target.toString());
  };

  if (!refid) {
    return returnToApp({ status: 'FAILED', error: 'session_not_found' });
  }

  let session;
  try {
    session = await digilockerAadhaarService.completeVerification(refid);
  } catch (err) {
    return returnToApp({ status: 'FAILED', error: 'session_not_found' });
  }

  return returnToApp({ verificationId: session._id.toString(), status: session.status });
});

const getDigilockerAadhaarVerification = asyncHandler(async (req, res) => {
  const data = await digilockerAadhaarService.getVerification(
    req.user.id,
    req.params.verificationId
  );

  successResponse(res, httpStatus.OK, MESSAGES.USER.DIGILOCKER_VERIFICATION_FETCHED, data);
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
  startDigilockerAadhaar,
  digilockerAadhaarCallback,
  getDigilockerAadhaarVerification,
  deleteAccount,
};
