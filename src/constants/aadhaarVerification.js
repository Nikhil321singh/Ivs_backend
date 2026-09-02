/**
 * Vocabulary for the DigiLocker Aadhaar verification flow, in one place so the
 * model, the service and the API response can never drift apart.
 */

/**
 * Session lifecycle. Ordered as the flow runs; every terminal state is listed
 * in TERMINAL_STATUSES below.
 */
const VERIFICATION_STATUS = Object.freeze({
  INITIATED: 'INITIATED', // our record exists, provider not yet called
  AUTHENTICATING: 'AUTHENTICATING', // authorization_url handed to the client
  AUTHENTICATED: 'AUTHENTICATED', // DigiLocker called our callback
  FETCHING_DOCUMENT: 'FETCHING_DOCUMENT', // access token obtained, listing files
  VERIFYING: 'VERIFYING', // Aadhaar XML downloaded, being parsed
  VERIFIED: 'VERIFIED', // done, Aadhaar bound to the account
  FAILED: 'FAILED',
  AADHAAR_NOT_FOUND: 'AADHAAR_NOT_FOUND', // DigiLocker account holds no Aadhaar
  EXPIRED: 'EXPIRED', // user never came back in time
});

// Once a session reaches one of these it can never move again — a second
// callback for the same refid is rejected rather than re-running the flow.
const TERMINAL_STATUSES = Object.freeze([
  VERIFICATION_STATUS.VERIFIED,
  VERIFICATION_STATUS.FAILED,
  VERIFICATION_STATUS.AADHAAR_NOT_FOUND,
  VERIFICATION_STATUS.EXPIRED,
]);

/**
 * Who a session verifies. The flow through DigiLocker is identical; what
 * differs is the write at the end.
 *
 *   ACCOUNT  — the logged-in partner proving their own identity. On success the
 *              Aadhaar is bound to the User (aadhaarVerified + hash), which is
 *              what gates KYC.
 *   CUSTOMER — the device seller, verified during an IMEI sale. The partner is
 *              only the operator here, so NOTHING is written to their account:
 *              binding a seller's Aadhaar to the partner would both falsely
 *              complete their KYC and burn the one-Aadhaar-per-account hash on
 *              someone else's identity.
 */
const VERIFICATION_SUBJECT = Object.freeze({
  ACCOUNT: 'ACCOUNT',
  CUSTOMER: 'CUSTOMER',
});

/**
 * Application-level failure codes. Provider errors are mapped onto these so the
 * client never sees a SprintVerify/DigiLocker-specific state.
 */
const FAILURE_CODE = Object.freeze({
  DIGILOCKER_SESSION_FAILED: 'DIGILOCKER_SESSION_FAILED',
  DIGILOCKER_AUTH_FAILED: 'DIGILOCKER_AUTH_FAILED',
  DIGILOCKER_TOKEN_FAILED: 'DIGILOCKER_TOKEN_FAILED',
  AADHAAR_NOT_FOUND: 'AADHAAR_NOT_FOUND',
  AADHAAR_DOWNLOAD_FAILED: 'AADHAAR_DOWNLOAD_FAILED',
  AADHAAR_XML_INVALID: 'AADHAAR_XML_INVALID',
  AADHAAR_VERIFICATION_FAILED: 'AADHAAR_VERIFICATION_FAILED',
  AADHAAR_ALREADY_LINKED: 'AADHAAR_ALREADY_LINKED',
  DIGILOCKER_SESSION_EXPIRED: 'DIGILOCKER_SESSION_EXPIRED',
  DIGILOCKER_PROVIDER_ERROR: 'DIGILOCKER_PROVIDER_ERROR',
});

/** The provider operations we call, used as the billing log's key. */
const PROVIDER_OPERATION = Object.freeze({
  INITIATE_SESSION: 'INITIATE_SESSION',
  ACCESS_TOKEN: 'ACCESS_TOKEN',
  ISSUED_FILES: 'ISSUED_FILES',
  DOWNLOAD_XML: 'DOWNLOAD_XML',
  REVOKE_TOKEN: 'REVOKE_TOKEN',
});

/**
 * DigiLocker's document type for Aadhaar. Matched on this rather than the
 * display name ("Aadhaar Card"), which is presentational and can be localised.
 */
const AADHAAR_DOCTYPE = 'ADHAR';

module.exports = {
  VERIFICATION_STATUS,
  VERIFICATION_SUBJECT,
  TERMINAL_STATUSES,
  FAILURE_CODE,
  PROVIDER_OPERATION,
  AADHAAR_DOCTYPE,
};
