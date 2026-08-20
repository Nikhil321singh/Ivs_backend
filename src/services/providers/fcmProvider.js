const admin = require('firebase-admin');
const env = require('../../config/env');

/**
 * Firebase Cloud Messaging (push notifications) provider.
 *
 * Credentials come from a Firebase service account (Project Settings ->
 * Service Accounts -> Generate new private key). The JSON's `project_id` /
 * `client_email` / `private_key` map to FCM_PROJECT_ID / FCM_CLIENT_EMAIL /
 * FCM_PRIVATE_KEY. `.env` can't hold real newlines, so the private key is
 * stored with literal `\n` escapes and unescaped below before use.
 *
 * `isConfigured()` mirrors the other integrations (Razorpay/C-DOT/S3) so the
 * server still boots before Firebase is provisioned — callers must check it
 * (or catch the "not configured" error surfaced by the service layer).
 */

const isConfigured = () => !!env.fcm.projectId && !!env.fcm.clientEmail && !!env.fcm.privateKey;

let cachedApp;
const app = () => {
  if (!cachedApp) {
    cachedApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.fcm.projectId,
        clientEmail: env.fcm.clientEmail,
        privateKey: env.fcm.privateKey.replace(/\\n/g, '\n'),
      }),
    });
  }
  return cachedApp;
};

// FCM error codes that mean the token is permanently dead (uninstalled app,
// expired registration, etc.) — safe to prune from the DB. Other errors
// (rate limits, transient server errors) are left alone so a good token
// isn't deleted over a blip.
const INVALID_TOKEN_ERROR_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

/**
 * Sends the same notification to a batch of device tokens. Never throws for
 * individual per-token failures — those are reported back via
 * successCount/failureCount/invalidTokens so the caller can prune dead
 * tokens. Throws only if FCM itself is unconfigured or the API call fails
 * outright (network/auth error).
 */
const sendToTokens = async (tokens, notification, data = {}) => {
  if (!tokens || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  // FCM requires all data payload values to be strings.
  const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));

  const response = await app().messaging().sendEachForMulticast({
    tokens,
    notification,
    data: stringData,
  });

  const invalidTokens = [];
  response.responses.forEach((result, index) => {
    if (!result.success && INVALID_TOKEN_ERROR_CODES.has(result.error?.code)) {
      invalidTokens.push(tokens[index]);
    }
  });

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens,
  };
};

module.exports = { isConfigured, sendToTokens };
