const axios = require('axios');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');

/* eslint-disable no-console */

/**
 * Firebase Cloud Messaging, HTTP v1.
 *
 * Implemented with axios + jsonwebtoken, matching the other providers in this
 * folder, rather than pulling in firebase-admin: the whole integration is two
 * HTTP calls (mint an OAuth token, POST a message) and the SDK would add gRPC
 * and a large transitive tree for them.
 *
 * The legacy `fcm.googleapis.com/fcm/send` endpoint with a server key is NOT
 * used — Google shut it down in 2024. v1 authenticates with a short-lived OAuth
 * access token, obtained by signing a JWT with the service account's private
 * key and exchanging it at Google's token endpoint.
 *
 * Two failure modes matter to callers and are reported separately:
 *   - a token that FCM says no longer exists (app uninstalled, token rotated).
 *     Returned in `invalidTokens` so the caller can retire the row; retrying it
 *     will never succeed.
 *   - everything else (timeouts, 5xx, quota). Counted as a failure and left
 *     alone, because the token is probably fine.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const REQUEST_TIMEOUT = 10000;

// Refresh a little before Google's one-hour expiry, so a send never races the
// boundary and fails with a 401 it would have to retry.
const TOKEN_TTL_SECONDS = 3600;
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

let cachedToken = null;
let cachedTokenExpiresAt = 0;

/**
 * All three credentials must be present, and the key must actually look like a
 * PEM — a half-pasted value (a common outcome of putting a multi-line key in a
 * hosting dashboard) would otherwise fail deep inside jwt.sign with a confusing
 * stack trace instead of being reported as "not configured".
 */
const isConfigured = () =>
  !!env.fcm.projectId &&
  !!env.fcm.clientEmail &&
  /BEGIN (RSA )?PRIVATE KEY/.test(env.fcm.privateKey || '');

/** Drops the cached OAuth token. Exported for tests and credential rotation. */
const resetAuthCache = () => {
  cachedToken = null;
  cachedTokenExpiresAt = 0;
};

const getAccessToken = async () => {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  const issuedAt = Math.floor(Date.now() / 1000);

  const assertion = jwt.sign(
    {
      iss: env.fcm.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + TOKEN_TTL_SECONDS,
    },
    env.fcm.privateKey,
    { algorithm: 'RS256' }
  );

  const response = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    {
      timeout: REQUEST_TIMEOUT,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  cachedToken = response.data.access_token;
  cachedTokenExpiresAt =
    Date.now() + (response.data.expires_in || TOKEN_TTL_SECONDS) * 1000 - TOKEN_REFRESH_MARGIN_MS;

  return cachedToken;
};

/**
 * FCM rejects a data payload containing anything but strings, and silently
 * drops undefined values. Stringify once here so every caller can pass the
 * natural shape ({ notificationId, updateAction, force: true }).
 */
const stringifyData = (data = {}) =>
  Object.entries(data).reduce((out, [key, value]) => {
    if (value === undefined || value === null) return out;
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
    return out;
  }, {});

/**
 * The v1 message envelope for one device.
 *
 * `notification` gives the OS something to display when the app is backgrounded
 * (Android draws it without waking the app at all); `data` is what the app
 * reads when it opens, which is why the routing fields are duplicated there.
 */
const buildMessage = ({ token, title, body, imageUrl, data }) => ({
  token,
  notification: {
    title,
    body,
    ...(imageUrl ? { image: imageUrl } : {}),
  },
  data: stringifyData(data),
  android: {
    // "high" is what lets a notification wake a dozing device. Anything the
    // user is expected to act on (an update wall, a wallet credit) is useless
    // if it arrives hours late.
    priority: 'high',
    notification: {
      channel_id: env.fcm.androidChannelId,
      sound: 'default',
      ...(imageUrl ? { image: imageUrl } : {}),
    },
  },
  apns: {
    headers: { 'apns-priority': '10' },
    payload: {
      aps: {
        sound: 'default',
        // Lets iOS surface the title/body while the app is in the foreground
        // too, instead of the app having to re-render it by hand.
        'mutable-content': 1,
      },
    },
  },
});

/**
 * True when FCM's answer means "this token is dead, stop using it".
 *
 * UNREGISTERED covers uninstalls and token rotation. A 400 INVALID_ARGUMENT on
 * the `message.token` field means the string was never a valid token — usually
 * a client sending a placeholder — and is equally permanent. Every other error
 * (quota, 5xx, network) is transient and must NOT retire the token, or one FCM
 * outage would silently unsubscribe the entire user base.
 */
const isDeadTokenError = (error) => {
  const status = error.response && error.response.status;
  const payload = (error.response && error.response.data && error.response.data.error) || {};
  const fcmCode = (payload.details || []).find((d) =>
    String(d['@type'] || '').includes('FcmError')
  );

  if (status === 404) return true;
  if (fcmCode && ['UNREGISTERED', 'INVALID_ARGUMENT'].includes(fcmCode.errorCode)) return true;

  return status === 400 && /not a valid FCM registration token|InvalidRegistration/i.test(
    JSON.stringify(payload.message || '')
  );
};

const sendOne = async (accessToken, message) => {
  await axios.post(
    `https://fcm.googleapis.com/v1/projects/${env.fcm.projectId}/messages:send`,
    { message, ...(env.fcm.dryRun ? { validate_only: true } : {}) },
    {
      timeout: REQUEST_TIMEOUT,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
};

/**
 * Delivers one notification to many device tokens.
 *
 * HTTP v1 has no multicast endpoint (the old /batch was retired), so this is
 * one request per device, run `env.fcm.concurrency` at a time — enough to push
 * a broadcast through quickly without opening a socket per user.
 *
 * Never throws. A push failing must not roll back the database work that
 * triggered it: the notification is already in the user's inbox, and the
 * summary returned here is what the caller records.
 *
 * @returns {{ skipped: boolean, successCount: number, failureCount: number,
 *             invalidTokens: string[], error: string|null }}
 */
const sendToTokens = async (tokens, payload) => {
  const unique = [...new Set((tokens || []).filter(Boolean))];

  const summary = {
    skipped: false,
    successCount: 0,
    failureCount: 0,
    invalidTokens: [],
    error: null,
  };

  if (unique.length === 0) return summary;

  if (!isConfigured()) {
    // Not an error: a deployment without Firebase credentials still records
    // notifications, it just cannot push them. Saying so plainly beats a
    // stack trace on every send in local development.
    summary.skipped = true;
    summary.error = 'FCM is not configured';
    return summary;
  }

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (error) {
    // A bad key or a clock skew fails here, for every device at once — worth a
    // log line, and worth clearing the cache so the next attempt re-mints.
    resetAuthCache();
    summary.failureCount = unique.length;
    summary.error = `FCM auth failed: ${error.message}`;
    console.error('[FCM] Could not obtain an access token:', error.message);
    return summary;
  }

  const queue = [...unique];

  const worker = async () => {
    for (;;) {
      const token = queue.shift();
      if (!token) return;

      try {
        // eslint-disable-next-line no-await-in-loop
        await sendOne(accessToken, buildMessage({ ...payload, token }));
        summary.successCount += 1;
      } catch (error) {
        summary.failureCount += 1;
        if (isDeadTokenError(error)) {
          summary.invalidTokens.push(token);
        } else if (!summary.error) {
          summary.error = error.message;
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(env.fcm.concurrency, queue.length) }, () => worker())
  );

  return summary;
};

module.exports = {
  isConfigured,
  sendToTokens,
  resetAuthCache,
  // Exported for tests — these carry the logic worth asserting on.
  buildMessage,
  stringifyData,
  isDeadTokenError,
};
