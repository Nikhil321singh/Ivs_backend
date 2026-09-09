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

const getCallbackUrl = () => env.razorpay.callbackUrl;

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

/**
 * Checkout options for the app's WebView, spread straight into the client's
 * Razorpay Checkout call. Shared by every kind of order we raise (token top-up
 * and credit pack alike) so this hard-won configuration lives in exactly one
 * place — it took a production UPI outage to get right, and a second copy would
 * inevitably drift.
 *
 * Inside a WebView the JS `handler` callback is unreliable — a UPI intent hands
 * control to the PSP app and the page that would have run the handler is gone —
 * so Checkout has to run in redirect mode instead: Razorpay POSTs the result to
 * `callback_url` and `webview_intent` lets Checkout fire the UPI intent out to
 * the native app.
 */
const getCheckoutOptions = () => ({
  callback_url: getCallbackUrl(),
  redirect: true,
  webview_intent: true,
  // Pin the UPI block to intent + QR. Two reasons:
  //
  // 1. NPCI retired UPI Collect on 28 Feb 2026, so a checkout that falls
  //    back to collect now renders an empty UPI section. Naming the flows
  //    explicitly keeps the block populated.
  // 2. QR needs nothing from the native wrapper. Intent only works once
  //    the app handles the `upi:`/`intent:` URL in shouldOverrideUrlLoading;
  //    until that ships, QR is the flow that still lets a user pay. Both
  //    are listed so the same payload keeps working after the app updates —
  //    no rebuild needed on either side of that change.
  //
  // show_default_blocks stays true so cards/netbanking/wallets still render
  // below the UPI block; `sequence` only promotes UPI to the top. If
  // Checkout ever ignores `flows` (it is not in the public docs — Razorpay
  // support recommends it), this degrades to a plain UPI block rather than
  // hiding anything.
  config: {
    display: {
      blocks: {
        upi: {
          name: 'Pay using UPI',
          instruments: [{ method: 'upi', flows: ['intent', 'qr'] }],
        },
      },
      sequence: ['block.upi'],
      preferences: { show_default_blocks: true },
    },
  },
});

module.exports = {
  isConfigured,
  getKeyId,
  getCallbackUrl,
  getCheckoutOptions,
  createOrder,
  verifyCheckoutSignature,
  verifyWebhookSignature,
};
