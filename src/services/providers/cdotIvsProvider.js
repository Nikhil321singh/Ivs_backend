const axios = require('axios');
const crypto = require('crypto');
const env = require('../../config/env');
const MESSAGES = require('../../constants/messages');

/**
 * IMEI blocklist verification against C-DOT's CEIR (Sanchar Saathi) API.
 * Deliberately never throws for expected failure modes (not configured, auth
 * failure, service unavailable) — it returns an ERROR/UNKNOWN status result
 * instead, so callers can offer a "supervisor override" rather than hard
 * failing a checkout flow. Only truly unexpected errors propagate.
 */

const IVS_STATUS = Object.freeze({
  CLEAN: 'CLEAN',
  BLOCKED: 'BLOCKED',
  STOLEN: 'STOLEN',
  UNKNOWN: 'UNKNOWN',
  ERROR: 'ERROR',
});

const MAX_RETRIES = 2;
const REQUEST_TIMEOUT = 10000;

let cachedAccessToken = null;
let cachedRefreshToken = null;
let tokenExpiresAt = null;

/* eslint-disable no-console */
const log = (...args) => console.log('[IVS Provider]', ...args);
const warn = (...args) => console.warn('[IVS Provider]', ...args);
const logError = (...args) => console.error('[IVS Provider]', ...args);
/* eslint-enable no-console */

const isConfigured = () => !!env.cdotIvs.baseUrl && !!env.cdotIvs.username && !!env.cdotIvs.password;

const generateReferenceId = () => `IVS-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

const isTokenExpired = () => !tokenExpiresAt || Date.now() >= tokenExpiresAt - 60000;

const decodeJwtPayload = (token) => {
  try {
    const base64url = token.split('.')[1];
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
  } catch {
    return {};
  }
};

const login = async () => {
  log('Authenticating with C-DOT API');

  const response = await axios.post(
    `${env.cdotIvs.baseUrl}/login`,
    { username: env.cdotIvs.username, password: env.cdotIvs.password },
    { timeout: REQUEST_TIMEOUT, headers: { 'Content-Type': 'application/json' } }
  );

  const { accessToken, refreshToken } = response.data;

  if (!accessToken) {
    throw new Error('Login response missing accessToken');
  }

  cachedAccessToken = accessToken;
  cachedRefreshToken = refreshToken || null;

  const payload = decodeJwtPayload(accessToken);
  tokenExpiresAt = (payload.exp || 0) * 1000;

  log('Authentication successful', { expiresAt: new Date(tokenExpiresAt).toISOString() });

  return accessToken;
};

const refreshAccessToken = async () => {
  if (!cachedRefreshToken) {
    warn('No refresh token available, re-logging in');
    return login();
  }

  log('Refreshing access token');

  const response = await axios.post(
    `${env.cdotIvs.baseUrl}/refresh`,
    { refreshToken: cachedRefreshToken },
    { timeout: REQUEST_TIMEOUT, headers: { 'Content-Type': 'application/json' } }
  );

  const { accessToken } = response.data;

  if (!accessToken) {
    throw new Error('Refresh response missing accessToken');
  }

  cachedAccessToken = accessToken;
  const payload = decodeJwtPayload(accessToken);
  tokenExpiresAt = (payload.exp || 0) * 1000;

  log('Token refreshed', { expiresAt: new Date(tokenExpiresAt).toISOString() });

  return accessToken;
};

const getValidAccessToken = async () => {
  if (cachedAccessToken && !isTokenExpired()) {
    return cachedAccessToken;
  }

  if (cachedRefreshToken) {
    try {
      return await refreshAccessToken();
    } catch (err) {
      warn('Token refresh failed, re-logging in', err.message);
    }
  }

  return login();
};

const mapCdotStatus = (cdotStatus) => {
  if (!cdotStatus) return IVS_STATUS.UNKNOWN;

  const normalized = cdotStatus.toLowerCase().trim();

  if (normalized === 'non-blocked') return IVS_STATUS.CLEAN;
  if (normalized === 'blocked') return IVS_STATUS.BLOCKED;
  if (normalized === 'stolen') return IVS_STATUS.STOLEN;
  return IVS_STATUS.UNKNOWN;
};

const checkSingleImei = async (imei, accessToken) => {
  const response = await axios.post(
    `${env.cdotIvs.baseUrl}/imei-status`,
    { imeis: [imei] },
    {
      timeout: REQUEST_TIMEOUT,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    }
  );

  const result = response.data;

  if (!result || typeof result !== 'object') {
    return { status: IVS_STATUS.ERROR, rawResponse: result };
  }

  const imeiData = result[imei];

  if (!imeiData) {
    return { status: IVS_STATUS.UNKNOWN, rawResponse: result };
  }

  return {
    status: mapCdotStatus(imeiData.status),
    rawCdotStatus: imeiData.status || null,
    rawResponse: result,
  };
};

const isRetryableError = (err) => {
  if (!err.response) return true;
  const status = err.response.status;
  return status >= 500 || status === 429;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const checkImeiWithRetry = async (imei, accessToken, referenceId) => {
  let currentToken = accessToken;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      if (attempt > 0) {
        await delay(Math.min(1000 * 2 ** attempt, 5000));
        if (attempt === 1 && isTokenExpired()) {
          currentToken = await getValidAccessToken();
        }
      }
      return await checkSingleImei(imei, currentToken);
    } catch (err) {
      warn(`IMEI check attempt ${attempt + 1} failed`, {
        referenceId,
        imeiSuffix: imei.slice(-4),
        message: err.message,
        status: err.response?.status,
      });

      if (err.response?.status === 401) {
        currentToken = await getValidAccessToken();
        continue; // eslint-disable-line no-continue
      }

      if (!isRetryableError(err)) break;
    }
  }

  return null;
};

const buildErrorResult = (referenceId, status, message) => ({
  imei1Status: status,
  imei1CdotStatus: null,
  imei2Status: null,
  imei2CdotStatus: null,
  allowTransaction: false,
  verifiedAt: new Date().toISOString(),
  referenceId,
  message,
  rawResponse: null,
});

const buildMessage = (imei1Result, imei2Result, imei2) => {
  const isClean = imei1Result.status === IVS_STATUS.CLEAN && (!imei2 || imei2Result?.status === IVS_STATUS.CLEAN);

  if (isClean) return MESSAGES.IVS.CLEAN;
  if (imei1Result.status === IVS_STATUS.BLOCKED) return MESSAGES.IVS.IMEI1_BLOCKED;
  if (imei1Result.status === IVS_STATUS.STOLEN) return MESSAGES.IVS.IMEI1_STOLEN;
  if (imei1Result.status === IVS_STATUS.UNKNOWN) return MESSAGES.IVS.IMEI1_UNKNOWN;
  return MESSAGES.IVS.UNABLE_TO_VERIFY;
};

const verifyImei = async ({ imei1, imei2 }) => {
  const referenceId = generateReferenceId();

  log('Starting verification', referenceId);

  if (!isConfigured()) {
    warn('C-DOT credentials not configured');
    return buildErrorResult(referenceId, IVS_STATUS.UNKNOWN, MESSAGES.IVS.NOT_CONFIGURED);
  }

  let accessToken;
  try {
    accessToken = await getValidAccessToken();
  } catch (err) {
    logError('Authentication failed', referenceId, err.message);
    return buildErrorResult(referenceId, IVS_STATUS.ERROR, MESSAGES.IVS.AUTH_FAILED);
  }

  const [imei1Result, imei2Result] = await Promise.all([
    checkImeiWithRetry(imei1, accessToken, referenceId),
    imei2 ? checkImeiWithRetry(imei2, accessToken, referenceId) : Promise.resolve(null),
  ]);

  if (!imei1Result) {
    return buildErrorResult(referenceId, IVS_STATUS.ERROR, MESSAGES.IVS.SERVICE_UNAVAILABLE);
  }

  return {
    imei1Status: imei1Result.status,
    imei1CdotStatus: imei1Result.rawCdotStatus || null,
    imei2Status: imei2Result ? imei2Result.status : null,
    imei2CdotStatus: imei2Result ? imei2Result.rawCdotStatus || null : null,
    allowTransaction: imei1Result.status === IVS_STATUS.CLEAN && (!imei2 || imei2Result?.status === IVS_STATUS.CLEAN),
    verifiedAt: new Date().toISOString(),
    referenceId,
    message: buildMessage(imei1Result, imei2Result, imei2),
    rawResponse: { imei1: imei1Result.rawResponse, imei2: imei2Result?.rawResponse || null },
  };
};

module.exports = { verifyImei, IVS_STATUS };
