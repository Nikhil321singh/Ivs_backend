const axios = require('axios');
const crypto = require('crypto');
const env = require('../../config/env');

/**
 * Razorpay integration for token top-ups. Implemented with axios + crypto
 * (no extra SDK dependency), matching the existing provider style. Handles
 * order creation and — critically — signature verification for both the
 * checkout callback and the server-to-server webhook.
 */

const REQUEST_TIMEOUT = 10000;

// Require a real Razorpay key id (rzp_test_/rzp_live_ prefix), not just a
// non-empty value — otherwise leftover .env placeholders pass this guard and
// fail deep inside a live API call with a confusing 500. This way an
// unconfigured setup fails fast with MESSAGES.PAYMENT.NOT_CONFIGURED.
const isConfigured = () =>
  /^rzp_(test|live)_/.test(env.razorpay.keyId || '') && !!env.razorpay.keySecret;

const getKeyId = () => env.razorpay.keyId;

const createOrder = async ({ amountPaise, currency = 'INR', receipt, notes }) => {
  const response = await axios.post(
    `${env.razorpay.apiBaseUrl}/orders`,
    { amount: amountPaise, currency, receipt, notes },
    {
      timeout: REQUEST_TIMEOUT,
      auth: { username: env.razorpay.keyId, password: env.razorpay.keySecret },
      headers: { 'Content-Type': 'application/json' },
    }
  );

  return response.data; // { id, amount, currency, receipt, notes, status, ... }
};

const hmacSha256 = (payload, secret) =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');

const safeEquals = (a, b) => {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Checkout signature = HMAC_SHA256(`${orderId}|${paymentId}`, key_secret).
 * Used by the client-side /verify fast-path.
 */
const verifyCheckoutSignature = ({ orderId, paymentId, signature }) =>
  safeEquals(hmacSha256(`${orderId}|${paymentId}`, env.razorpay.keySecret), signature);

/**
 * Webhook signature = HMAC_SHA256(rawBody, webhook_secret), sent in the
 * `x-razorpay-signature` header. Must be computed over the *raw* request body.
 */
const verifyWebhookSignature = (rawBody, signature) => {
  if (!env.razorpay.webhookSecret) return false;
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  return safeEquals(hmacSha256(payload, env.razorpay.webhookSecret), signature);
};

module.exports = {
  isConfigured,
  getKeyId,
  createOrder,
  verifyCheckoutSignature,
  verifyWebhookSignature,
};
