const crypto = require('crypto');
const AadhaarVerification = require('../models/AadhaarVerification.model');
const ProviderRequestLog = require('../models/ProviderRequestLog.model');
const User = require('../models/User.model');
const provider = require('./providers/digiLockerProvider');
const { parse, AadhaarXmlError } = require('../utils/aadhaarXmlParser');
const { hashAadhaar } = require('../utils/hash.util');
const env = require('../config/env');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const {
  VERIFICATION_STATUS,
  TERMINAL_STATUSES,
  FAILURE_CODE,
  PROVIDER_OPERATION,
  AADHAAR_DOCTYPE,
} = require('../constants/aadhaarVerification');

/* eslint-disable no-console */

/**
 * DigiLocker Aadhaar verification.
 *
 * Owns the session state machine and every decision about it; the provider
 * client below it does HTTP only, and the XML parser is a pure function. The
 * split means the rules here can be tested without a network and the parser can
 * be tested without a database.
 */

/**
 * The refid is a capability, not an identifier.
 *
 * DigiLocker redirects the user's browser back to our callback with no bearer
 * token, so whatever arrives is anonymous. The refid is therefore the only
 * thing binding that request to an account, and it must be unguessable: 16
 * random bytes, unique-indexed, and single-use because a session in a terminal
 * status is never re-run.
 */
const generateRefid = () => crypto.randomBytes(16).toString('hex');

/** Records a provider call for billing reconciliation. Never throws. */
const logProviderCall = async (operation, refid, userId, result) => {
  try {
    await ProviderRequestLog.create({
      provider: 'DIGILOCKER',
      userId,
      refid,
      operation,
      providerStatus: result.status,
      billable: result.billable,
      providerMessage: result.message,
      durationMs: result.durationMs,
    });
  } catch (err) {
    // A billing log write must never break a user's verification. Loud, so the
    // row can be reconstructed from logs if an invoice is ever disputed.
    console.error('[DigiLocker] Billing log write failed', {
      operation,
      refid,
      billable: result.billable,
      error: err.message,
    });
  }
};

const fail = async (session, failureCode, failureReason) => {
  session.status =
    failureCode === FAILURE_CODE.AADHAAR_NOT_FOUND
      ? VERIFICATION_STATUS.AADHAAR_NOT_FOUND
      : VERIFICATION_STATUS.FAILED;
  session.failureCode = failureCode;
  session.failureReason = failureReason || null;
  await session.save();

  return session;
};

/**
 * Opens a verification session and returns the URL the client must send the
 * user to.
 *
 * Any earlier non-terminal session for this user is expired first: leaving two
 * live sessions open would leave two usable callback capabilities outstanding
 * for one account.
 */
const startVerification = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUTH.USER_NOT_FOUND);
  }

  if (user.aadhaarVerified) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.USER.AADHAAR_ALREADY_VERIFIED);
  }

  await AadhaarVerification.updateMany(
    { userId, status: { $nin: TERMINAL_STATUSES } },
    { status: VERIFICATION_STATUS.EXPIRED, failureCode: FAILURE_CODE.DIGILOCKER_SESSION_EXPIRED }
  );

  const refid = generateRefid();
  const session = await AadhaarVerification.create({
    userId,
    refid,
    status: VERIFICATION_STATUS.INITIATED,
    expiresAt: new Date(Date.now() + env.digilocker.sessionTtlMinutes * 60 * 1000),
  });

  // The refid is carried in the redirect URL we hand the provider, rather than
  // relying on DigiLocker to echo one back. The documentation does not specify
  // what the callback receives, and this makes that irrelevant: whatever else
  // arrives, our own refid is always present and the session is always found.
  const callbackUrl = new URL(env.digilocker.redirectUrl);
  callbackUrl.searchParams.set('refid', refid);

  const result = await provider.initiateSession(refid, callbackUrl.toString());
  await logProviderCall(PROVIDER_OPERATION.INITIATE_SESSION, refid, userId, result);

  if (!result.ok) {
    await fail(session, FAILURE_CODE.DIGILOCKER_SESSION_FAILED, result.message);
    throw new ApiError(httpStatus.BAD_GATEWAY, MESSAGES.USER.DIGILOCKER_SESSION_FAILED);
  }

  session.status = VERIFICATION_STATUS.AUTHENTICATING;
  await session.save();

  return { verificationId: session._id.toString(), authorizationUrl: result.authorizationUrl };
};

/**
 * Runs everything after the user finishes inside DigiLocker: access token,
 * issued files, Aadhaar lookup, download, parse, and the User write.
 *
 * Called from the unauthenticated callback, so the refid is the only credential
 * — it is looked up, checked for terminal status, and checked for expiry before
 * anything else happens. An unknown refid is a 404 and nothing else: it must
 * not reveal whether a session ever existed.
 *
 * Returns the session rather than throwing on a verification failure, because
 * the callback's job is to record the outcome and redirect the user either way.
 */
const completeVerification = async (refid) => {
  const session = await AadhaarVerification.findOne({ refid });

  if (!session) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.USER.DIGILOCKER_SESSION_NOT_FOUND);
  }

  if (TERMINAL_STATUSES.includes(session.status)) {
    // Replayed callback. Not an error — return what already happened rather
    // than re-running a billable flow.
    return session;
  }

  if (session.expiresAt.getTime() < Date.now()) {
    session.status = VERIFICATION_STATUS.EXPIRED;
    session.failureCode = FAILURE_CODE.DIGILOCKER_SESSION_EXPIRED;
    await session.save();
    return session;
  }

  const { userId } = session;

  session.status = VERIFICATION_STATUS.AUTHENTICATED;
  await session.save();

  // 1. Access token — proves the DigiLocker authentication completed.
  const token = await provider.accessToken(refid);
  await logProviderCall(PROVIDER_OPERATION.ACCESS_TOKEN, refid, userId, token);
  if (!token.ok) {
    return fail(session, FAILURE_CODE.DIGILOCKER_TOKEN_FAILED, token.message);
  }

  // 2. Issued files.
  session.status = VERIFICATION_STATUS.FETCHING_DOCUMENT;
  await session.save();

  const listing = await provider.issuedFiles(refid);
  await logProviderCall(PROVIDER_OPERATION.ISSUED_FILES, refid, userId, listing);
  if (!listing.ok) {
    return fail(session, FAILURE_CODE.DIGILOCKER_PROVIDER_ERROR, listing.message);
  }

  // 3. Find Aadhaar by doctype, never by display name — the name is
  //    presentational and can be localised or reworded by the issuer.
  const aadhaarFile = listing.files.find(
    (file) => String(file.doctype).toUpperCase() === AADHAAR_DOCTYPE
  );

  if (!aadhaarFile || !aadhaarFile.uri) {
    // Not an error condition: the account simply holds no Aadhaar. Stop here
    // without calling download, which would be a billable call for nothing.
    return fail(session, FAILURE_CODE.AADHAAR_NOT_FOUND, null);
  }

  // 4. Download only that document.
  const download = await provider.downloadXml(refid, aadhaarFile.uri);
  await logProviderCall(PROVIDER_OPERATION.DOWNLOAD_XML, refid, userId, download);
  if (!download.ok) {
    return fail(session, FAILURE_CODE.AADHAAR_DOWNLOAD_FAILED, download.message);
  }

  // 5. Decode and parse. The raw XML never leaves this scope and is never
  //    logged or persisted.
  session.status = VERIFICATION_STATUS.VERIFYING;
  await session.save();

  let details;
  try {
    details = parse(download.base64Xml);
  } catch (err) {
    if (err instanceof AadhaarXmlError) {
      console.error('[DigiLocker] Aadhaar XML rejected', { refid, reason: err.reason });
      return fail(session, FAILURE_CODE.AADHAAR_XML_INVALID, err.reason);
    }
    throw err;
  }

  // 6. Bind the Aadhaar to the account, writing exactly the fields the OTP
  //    flow writes so every existing consumer of aadhaarVerified is unaffected.
  //    The hash is what enforces one-Aadhaar-per-account; it is derived from
  //    the masked value here because the full number is never available to us
  //    through DigiLocker.
  const user = await User.findById(userId);
  if (user) {
    user.aadhaarVerified = true;
    user.aadhaarNumber = details.maskedAadhaar;
    if (details.maskedAadhaar) {
      user.aadhaarNumberHash = hashAadhaar(details.maskedAadhaar, userId);
    }
    await user.save();
  }

  session.status = VERIFICATION_STATUS.VERIFIED;
  session.name = details.name;
  session.dateOfBirth = details.dateOfBirth;
  session.gender = details.gender;
  session.maskedAadhaar = details.maskedAadhaar;
  session.verifiedAt = new Date();
  await session.save();

  return session;
};

/**
 * The client-facing view of a session. Scoped to the caller's own userId, so a
 * guessed verification id reveals nothing — an id belonging to someone else is
 * indistinguishable from one that does not exist.
 */
const getVerification = async (userId, verificationId) => {
  const session = await AadhaarVerification.findOne({ _id: verificationId, userId });

  if (!session) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.USER.DIGILOCKER_SESSION_NOT_FOUND);
  }

  return {
    verificationId: session._id.toString(),
    status: session.status,
    verified: session.status === VERIFICATION_STATUS.VERIFIED,
    name: session.name,
    maskedAadhaar: session.maskedAadhaar,
    dateOfBirth: session.dateOfBirth,
    gender: session.gender,
    verifiedAt: session.verifiedAt,
    failureCode: session.failureCode,
  };
};

module.exports = {
  startVerification,
  completeVerification,
  getVerification,
  generateRefid,
};
