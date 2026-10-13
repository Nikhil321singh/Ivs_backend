const axios = require('axios');
const env = require('../../config/env');

/* eslint-disable no-console */

/**
 * Blancco device-diagnosis provider (app side).
 *
 * CONTRACT TBD — the URL patterns, auth mechanism and response shapes below
 * are placeholders. Once the Blancco API is documented, adjust:
 *   - blanccoRedirectUrl()  — where the customer lands after scanning the QR
 *   - checkStatus()         — how to ask whether a diagnosis finished
 *   - getReport()           — how to pull the diagnosis results
 */

const REQUEST_TIMEOUT = 15000;

const isConfigured = () => !!env.blanccoApp.baseUrl && !!env.blanccoApp.apiKey;

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${env.blanccoApp.apiKey}`,
});

// The URL our scan endpoint redirects the customer to after marking the QR used.
const blanccoRedirectUrl = (sessionToken) =>
  `${env.blanccoApp.baseUrl}/diagnose/${sessionToken}`;

// The URL encoded into the QR itself — points to OUR server so we can enforce
// one-time use before forwarding to Blancco.
const buildScanUrl = (sessionToken) =>
  `${env.apiBaseUrl}/api/v1/blancco/scan/${sessionToken}`;

const checkStatus = async (sessionToken) => {
  if (!isConfigured()) {
    console.warn('[Blancco Provider] not configured');
    return { completed: false, error: 'NOT_CONFIGURED' };
  }

  try {
    const { data } = await axios.get(
      `${env.blanccoApp.baseUrl}/status/${sessionToken}`,
      { timeout: REQUEST_TIMEOUT, headers: headers() }
    );

    // TODO: map real response shape.
    return { completed: !!data?.completed, raw: data };
  } catch (err) {
    console.error('[Blancco Provider] status check failed', err.message);
    return { completed: false, error: err.message };
  }
};

const getReport = async (sessionToken) => {
  if (!isConfigured()) {
    console.warn('[Blancco Provider] not configured');
    return { success: false, report: null, error: 'NOT_CONFIGURED' };
  }

  try {
    const { data } = await axios.get(
      `${env.blanccoApp.baseUrl}/report/${sessionToken}`,
      { timeout: REQUEST_TIMEOUT, headers: headers() }
    );

    // TODO: map the real response shape once the Blancco contract is known.
    return { success: true, report: data, error: null };
  } catch (err) {
    console.error('[Blancco Provider] report fetch failed', err.message);
    return { success: false, report: null, error: err.message };
  }
};

module.exports = { isConfigured, buildScanUrl, blanccoRedirectUrl, checkStatus, getReport };
