const axios = require('axios');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const ApiError = require('../../utils/apiError');
const httpStatus = require('../../constants/httpStatus');
const MESSAGES = require('../../constants/messages');

/**
 * Aadhaar e-KYC via the GREST wrapper around Paysprint's UIDAI OTP API —
 * the same integration already running in production in another app.
 * aadhaar.service.js only depends on this module's shape:
 *   sendOtp(aadhaarNumber) => { refId }
 *   verifyOtp(refId, otp)  => { success }
 */

const hasPaysprintConfig = () => !!env.paysprint.partnerId && !!env.paysprint.authorisedKey;

// --- Test mode -------------------------------------------------------------
// When AADHAAR_TEST_MODE=true, the sandbox Aadhaar numbers in
// AADHAAR_TEST_NUMBERS resolve entirely in-process: sendOtp mints a refId
// carrying the TEST_REF_PREFIX and verifyOtp accepts AADHAAR_TEST_OTP for it.
// Paysprint is never contacted, so this also works before its credentials are
// provisioned. Intercepting here (rather than in aadhaar.service.js) means every
// caller — account KYC send/verify AND the stateless customer/IVS pair — is
// covered by one branch, and the downstream aadhaarVerified + aadhaarNumberHash
// writes in completeKyc still run exactly as they do in production.
// Any Aadhaar not on the list falls through to the real provider untouched.
const TEST_REF_PREFIX = 'TESTREF-';

const isTestAadhaar = (aadhaarNumber) =>
  env.aadhaarTest.enabled && env.aadhaarTest.numbers.includes(String(aadhaarNumber));

// Guarded by `enabled` too, so flipping the flag off immediately invalidates any
// test refId still held by a client.
const isTestRef = (refId) =>
  env.aadhaarTest.enabled && typeof refId === 'string' && refId.startsWith(TEST_REF_PREFIX);

// Deliberately does NOT embed the Aadhaar number — in the customer/IVS flow the
// refId round-trips through the client.
const makeTestRef = () => `${TEST_REF_PREFIX}${Date.now()}${Math.floor(Math.random() * 1000)}`;

const assertConfigured = () => {
  if (!hasPaysprintConfig()) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, MESSAGES.USER.AADHAAR_PROVIDER_CONFIG_MISSING);
  }
};

// Paysprint's UIDAI upstream validates the token's timestamp/iat with NO clock
// skew leeway and its server clock frequently lags real time, so a token stamped
// at "now" is rejected as being in the future:
//   "Cannot handle token prior to <timestamp>"
// (Seen intermittently — send-otp passes while verify-otp fails moments later.)
// Backdate both the custom `timestamp` claim and the JWT `iat` by a safety margin
// so the token always sits comfortably in the provider's past. The token is used
// immediately, so a small backdate is safe against any max-age check.
const TOKEN_SKEW_SECONDS = 120;

const generatePaysprintToken = () => {
  const issuedAt = Math.floor(Date.now() / 1000) - TOKEN_SKEW_SECONDS;
  const payload = {
    iat: issuedAt,
    timestamp: issuedAt,
    partnerId: env.paysprint.partnerId,
    reqid: `${Date.now()}${Math.floor(Math.random() * 10)}`,
  };

  // noTimestamp so jsonwebtoken doesn't overwrite our backdated `iat` with now.
  return jwt.sign(payload, env.paysprint.authorisedKey, {
    algorithm: 'HS256',
    noTimestamp: true,
  });
};

const wrapperClient = axios.create({
  baseURL: env.grestWrapper.baseUrl,
  headers: {
    'Content-Type': 'application/json',
    Authorization: env.grestWrapper.authToken,
  },
  timeout: 120000,
  // The wrapper can return a non-JSON (HTML) timeout body with a 200/408 —
  // let isHtmlTimeout below classify it instead of axios throwing on 4xx.
  validateStatus: (status) => status < 500,
});

const isHtmlTimeout = (response) =>
  response.status === 408 || (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>'));

// ECONNABORTED/ETIMEDOUT: our own axios timeout fired.
// 502/503/504: the wrapper's nginx gave up waiting on its own upstream
// (e.g. Paysprint) before responding to us — same "try again later" case.
const isTimeoutError = (error) =>
  ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code) || [502, 503, 504].includes(error.response?.status);

/* eslint-disable no-console */
const logProviderError = (action, details) => {
  console.error(`[Aadhaar Provider] ${action} failed:`, JSON.stringify(details, null, 2));
};
/* eslint-enable no-console */

const sendOtp = async (aadhaarNumber) => {
  // Before assertConfigured, so test mode works without Paysprint credentials.
  if (isTestAadhaar(aadhaarNumber)) {
    // eslint-disable-next-line no-console
    console.warn(`[Aadhaar Provider] TEST MODE: skipping provider sendOtp for ${aadhaarNumber}`);
    return { refId: makeTestRef() };
  }

  assertConfigured();

  let response;

  try {
    response = await wrapperClient.post('/initiateAadhaar', {
      id_number: aadhaarNumber,
      token: generatePaysprintToken(),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      logProviderError('sendOtp', {
        code: error.code,
        message: error.message,
        responseStatus: error.response?.status,
      });
      throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.USER.AADHAAR_PROVIDER_TIMEOUT);
    }
    logProviderError('sendOtp', {
      code: error.code,
      message: error.message,
      responseStatus: error.response?.status,
      responseData: error.response?.data,
    });
    throw new ApiError(httpStatus.BAD_REQUEST, error.response?.data?.message || MESSAGES.OTP.SEND_FAILED);
  }

  if (isHtmlTimeout(response)) {
    logProviderError('sendOtp', { reason: 'html-timeout', status: response.status });
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.USER.AADHAAR_PROVIDER_TIMEOUT);
  }

  const payload = response.data || {};

  if (!payload.success || !payload.data?.client_id) {
    logProviderError('sendOtp', { status: response.status, payload });
    throw new ApiError(httpStatus.BAD_REQUEST, payload.message || MESSAGES.OTP.SEND_FAILED);
  }

  return { refId: payload.data.client_id };
};

const verifyOtp = async (refId, otp) => {
  if (isTestRef(refId)) {
    const success = String(otp) === env.aadhaarTest.otp;
    // eslint-disable-next-line no-console
    console.warn(`[Aadhaar Provider] TEST MODE: local verifyOtp, success=${success}`);
    return { success };
  }

  assertConfigured();

  let response;

  try {
    response = await wrapperClient.post('/verifyAadhaar', {
      client_id: refId,
      otp,
      token: generatePaysprintToken(),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      logProviderError('verifyOtp', {
        code: error.code,
        message: error.message,
        responseStatus: error.response?.status,
      });
      throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.USER.AADHAAR_PROVIDER_TIMEOUT);
    }
    logProviderError('verifyOtp', {
      code: error.code,
      message: error.message,
      responseStatus: error.response?.status,
      responseData: error.response?.data,
    });
    throw new ApiError(httpStatus.BAD_REQUEST, error.response?.data?.message || MESSAGES.USER.AADHAAR_OTP_INVALID);
  }

  if (isHtmlTimeout(response)) {
    logProviderError('verifyOtp', { reason: 'html-timeout', status: response.status });
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.USER.AADHAAR_PROVIDER_TIMEOUT);
  }

  const payload = response.data || {};

  if (!payload.success) {
    logProviderError('verifyOtp', { status: response.status, payload });
  }

  return { success: !!payload.success };
};

module.exports = { sendOtp, verifyOtp };
