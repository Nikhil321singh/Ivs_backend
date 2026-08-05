const crypto = require('crypto');
const nock = require('nock');

const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const API_BASE = 'https://api.razorpay.com';

/**
 * Test-side reimplementation of the exact signatures the server verifies, so
 * tests can produce VALID signatures (and, by tampering, invalid ones) using
 * the same secrets configured in test/setup/env.js.
 */
const hmac = (payload, secret) =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');

// Checkout signature = HMAC(`${orderId}|${paymentId}`, key_secret).
const checkoutSignature = (orderId, paymentId) =>
  hmac(`${orderId}|${paymentId}`, KEY_SECRET);

// Webhook signature = HMAC(rawBody, webhook_secret).
const webhookSignature = (rawBody) => hmac(rawBody, WEBHOOK_SECRET);

/**
 * Stubs Razorpay's order-creation endpoint so createTopupOrder() gets a real
 * order id without any network call. Returns the fake order id used.
 */
const stubCreateOrder = (orderId = `order_${Date.now()}`) => {
  nock(API_BASE)
    .post('/v1/orders')
    .reply(200, (uri, body) => ({
      id: orderId,
      amount: body.amount,
      currency: body.currency || 'INR',
      receipt: body.receipt,
      notes: body.notes,
      status: 'created',
    }));
  return orderId;
};

/** Builds a signed webhook body + header pair for a given event. */
const buildWebhook = (event, orderId, paymentId) => {
  const body = JSON.stringify({
    event,
    payload: { payment: { entity: { id: paymentId, order_id: orderId } } },
  });
  return { body, signature: webhookSignature(body) };
};

module.exports = {
  checkoutSignature,
  webhookSignature,
  stubCreateOrder,
  buildWebhook,
};
