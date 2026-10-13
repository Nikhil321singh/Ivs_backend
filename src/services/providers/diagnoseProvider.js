const axios = require('axios');
const crypto = require('crypto');
const env = require('../../config/env');

/* eslint-disable no-console */

/**
 * Third-party device-diagnosis provider.
 *
 * ⚠️ CONTRACT TBD — the request payload and response mapping below are
 * placeholders. Once the vendor API is known, adjust:
 *   - the request URL/body in `diagnose()`
 *   - the mapping of the vendor response → { resultStatus, result }
 *
 * Follows the same contract as cdotIvsProvider: it NEVER throws for expected
 * failure modes (unconfigured / timeout / service down) — it returns
 * UNKNOWN/ERROR so the caller can log the attempt and NOT charge the user.
 * Only a SUCCESS is billable.
 */

const RESULT_STATUS = Object.freeze({
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
  UNKNOWN: 'UNKNOWN',
});

const REQUEST_TIMEOUT = 15000;

const isConfigured = () => {
  // Try Blancco credentials first, fall back to DIAGNOSE env vars
  const hasBlancco = !!process.env.BLANCCO_API_URL_APP && !!process.env.BLANCCO_API_KEY_APP;
  const hasDiagnose = !!env.diagnose.baseUrl && !!env.diagnose.apiKey;
  return hasBlancco || hasDiagnose;
};

const getProvider = () => {
  const hasBlancco = !!process.env.BLANCCO_API_URL_APP && !!process.env.BLANCCO_API_KEY_APP;

  if (hasBlancco) {
    return {
      baseUrl: process.env.BLANCCO_API_URL_APP,
      apiKey: process.env.BLANCCO_API_KEY_APP,
      endpoint: '/v1/diagnose'
    };
  }

  return {
    baseUrl: env.diagnose.baseUrl,
    apiKey: env.diagnose.apiKey,
    endpoint: '/diagnose'
  };
};

const generateRefId = () => `DIAG-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

const diagnose = async (input) => {
  const providerRefId = generateRefId();

  if (!isConfigured()) {
    console.warn('[Diagnose Provider] not configured');
    return { resultStatus: RESULT_STATUS.UNKNOWN, providerRefId, result: null, rawResponse: null };
  }

  try {
    const provider = getProvider();
    const response = await axios.post(`${provider.baseUrl}${provider.endpoint}`, input, {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
    });

    // TODO: map the vendor's real success/failure shape here.
    return {
      resultStatus: RESULT_STATUS.SUCCESS,
      providerRefId: response.data?.referenceId || providerRefId,
      result: response.data,
      rawResponse: response.data,
    };
  } catch (err) {
    console.error('[Diagnose Provider] request failed', providerRefId, err.message);
    return {
      resultStatus: RESULT_STATUS.ERROR,
      providerRefId,
      result: null,
      rawResponse: err.response?.data || null,
    };
  }
};

module.exports = { diagnose, isConfigured, getProvider, RESULT_STATUS };
