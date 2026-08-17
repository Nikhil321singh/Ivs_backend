const axios = require('axios');
const env = require('../../config/env');
const { generatePaysprintToken } = require('../../utils/paysprintToken');
const ApiError = require('../../utils/apiError');
const httpStatus = require('../../constants/httpStatus');
const MESSAGES = require('../../constants/messages');
const { PROVIDER_OPERATION, FAILURE_CODE } = require('../../constants/aadhaarVerification');

/* eslint-disable no-console */

/**
 * SprintVerify DigiLocker client. HTTP only — it knows nothing about users,
 * sessions or verification rules; digilockerAadhaar.service.js owns all of that.
 *
 * Four operations, in the order the flow runs:
 *   initiateSession(refid, redirectUrl) => { authorizationUrl }
 *   accessToken(refid)                  => { ok }
 *   issuedFiles(refid)                  => { files: [{ name, doctype, issuer, uri }] }
 *   downloadXml(refid, uri)             => { base64Xml }
 *
 * Every call mints a fresh JWT (see utils/paysprintToken.js) — the provider
 * requires one per request and rejects reuse.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSE MAPPING IS UNCONFIRMED. The integration brief specifies the request
 * side (paths and parameters) but not the exact success/error response bodies.
 * Every assumption about response shape is therefore isolated in the `pick*`
 * helpers below and nowhere else, so confirming them against the real UAT
 * responses is a change to this one section rather than to the flow. Each
 * helper is deliberately tolerant of the casings SprintVerify mixes across its
 * products (snake_case and camelCase) and fails loudly rather than returning
 * undefined.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PATHS = Object.freeze({
  [PROVIDER_OPERATION.INITIATE_SESSION]: '/digilocker/initiate_session',
  [PROVIDER_OPERATION.ACCESS_TOKEN]: '/digilocker/access_token',
  [PROVIDER_OPERATION.ISSUED_FILES]: '/digilocker/issued_files',
  [PROVIDER_OPERATION.DOWNLOAD_XML]: '/digilocker/download_xml',
});

// Per the provider's billing rules: a 200 or a 422 is charged, a 201 is not.
// Anything else never completed a billable unit of work.
const BILLABLE_STATUSES = [200, 422];
const isBillable = (status) => BILLABLE_STATUSES.includes(status);

const isConfigured = () =>
  !!env.paysprint.partnerId && !!env.paysprint.authorisedKey && !!env.paysprint.baseUrl;

const assertConfigured = () => {
  if (!isConfigured()) {
    // Deliberately vague to the caller, specific in the log: a client must not
    // learn which provider secret is missing.
    console.error('[DigiLocker] Not configured', {
      hasPartnerId: !!env.paysprint.partnerId,
      hasAuthorisedKey: !!env.paysprint.authorisedKey,
      hasBaseUrl: !!env.paysprint.baseUrl,
    });
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      MESSAGES.USER.AADHAAR_PROVIDER_CONFIG_MISSING
    );
  }
};

const client = axios.create({
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
  // Handle 4xx ourselves so a 422 can be classified (and billed) rather than
  // thrown as a generic axios error.
  validateStatus: (status) => status < 500,
});

/**
 * Issues one provider request and reports everything the caller needs to log a
 * billing row — including on failure, because a failed call can still be
 * chargeable.
 *
 * Never throws for a provider-level failure; returns `ok: false` instead, so
 * the service layer decides how a given operation's failure maps to a state.
 */
const call = async (operation, body) => {
  assertConfigured();

  const startedAt = Date.now();
  const url = `${env.paysprint.baseUrl}${PATHS[operation]}`;

  try {
    const response = await client.post(url, body, {
      headers: {
        // Fresh per request — never cached, never reused.
        Token: generatePaysprintToken(),
        Authorisedkey: env.paysprint.authorisedKey,
        // The provider rejects requests without a User-Agent.
        'User-Agent': 'ivs-backend',
      },
    });

    return {
      ok: response.status === 200,
      status: response.status,
      billable: isBillable(response.status),
      data: response.data,
      message: pickMessage(response.data),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    // Transport-level failure: the request never produced a provider response,
    // so nothing was billed.
    console.error('[DigiLocker] Request failed', {
      operation,
      code: error.code,
      status: error.response?.status ?? null,
    });

    return {
      ok: false,
      status: error.response?.status ?? null,
      billable: false,
      data: null,
      message: error.code || 'request_failed',
      durationMs: Date.now() - startedAt,
    };
  }
};

/* --- Response mapping (UNCONFIRMED — see the header note) ----------------- */

const pickMessage = (data) => {
  if (!data || typeof data !== 'object') return null;
  const raw = data.message ?? data.msg ?? data.status_message ?? null;
  // Truncated: a provider message is for support, and must not become a channel
  // for unbounded (or sensitive) data landing in our logs and database.
  return typeof raw === 'string' ? raw.slice(0, 200) : null;
};

const pickAuthorizationUrl = (data) => {
  const d = data?.data ?? data ?? {};
  return d.authorization_url ?? d.authorizationUrl ?? d.url ?? null;
};

const pickIssuedFiles = (data) => {
  const d = data?.data ?? data ?? {};
  const files = d.files ?? d.issued_files ?? d.issuedFiles ?? d.documents ?? [];
  if (!Array.isArray(files)) return [];

  return files.map((file) => ({
    name: file.name ?? null,
    doctype: file.doctype ?? file.docType ?? file.doc_type ?? null,
    issuer: file.issuer ?? null,
    uri: file.uri ?? file.URI ?? null,
  }));
};

const pickBase64Xml = (data) => {
  const d = data?.data ?? data ?? {};
  return d.xml ?? d.document ?? d.base64 ?? d.file ?? null;
};

/* --- Operations ----------------------------------------------------------- */

/**
 * Opens a DigiLocker authorization session. The refid must be unique per
 * session and is reused for every later call in the same flow.
 */
const initiateSession = async (refid, redirectUrl) => {
  const result = await call(PROVIDER_OPERATION.INITIATE_SESSION, {
    refid,
    redirect_url: redirectUrl,
  });

  const authorizationUrl = result.ok ? pickAuthorizationUrl(result.data) : null;

  return {
    ...result,
    ok: result.ok && !!authorizationUrl,
    authorizationUrl,
    failureCode: FAILURE_CODE.DIGILOCKER_SESSION_FAILED,
  };
};

/** Exchanges a completed DigiLocker authentication for provider-side access. */
const accessToken = async (refid) => {
  const result = await call(PROVIDER_OPERATION.ACCESS_TOKEN, { refid });

  return { ...result, failureCode: FAILURE_CODE.DIGILOCKER_TOKEN_FAILED };
};

/** Lists the documents issued to the authenticated DigiLocker account. */
const issuedFiles = async (refid) => {
  const result = await call(PROVIDER_OPERATION.ISSUED_FILES, { refid });

  return {
    ...result,
    files: result.ok ? pickIssuedFiles(result.data) : [],
    failureCode: FAILURE_CODE.DIGILOCKER_PROVIDER_ERROR,
  };
};

/** Downloads one issued document as Base64 XML, by the uri from issuedFiles. */
const downloadXml = async (refid, uri) => {
  const result = await call(PROVIDER_OPERATION.DOWNLOAD_XML, { refid, uri });

  const base64Xml = result.ok ? pickBase64Xml(result.data) : null;

  return {
    ...result,
    ok: result.ok && !!base64Xml,
    base64Xml,
    failureCode: FAILURE_CODE.AADHAAR_DOWNLOAD_FAILED,
  };
};

module.exports = {
  isConfigured,
  initiateSession,
  accessToken,
  issuedFiles,
  downloadXml,
};
