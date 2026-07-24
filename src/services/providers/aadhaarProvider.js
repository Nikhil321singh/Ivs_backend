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

const assertConfigured = () => {
  if (!hasPaysprintConfig()) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, MESSAGES.USER.AADHAAR_PROVIDER_CONFIG_MISSING);
  }
};

const generatePaysprintToken = () => {
  const payload = {
    timestamp: Math.floor(Date.now() / 1000),
    partnerId: env.paysprint.partnerId,
    reqid: `${Date.now()}${Math.floor(Math.random() * 10)}`,
  };

  return jwt.sign(payload, env.paysprint.authorisedKey, { algorithm: 'HS256' });
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
