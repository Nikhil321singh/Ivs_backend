const Payment = require('../models/Payment.model');
const razorpay = require('./providers/razorpayProvider');
const walletService = require('./wallet.service');
const referralService = require('./referral.service');
const PRICING = require('../constants/pricing');
const { PAYMENT_STATUS, TXN_REASON, TXN_REF_TYPE } = require('../constants/walletEnums');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/* eslint-disable no-console */

/**
 * Creates a Razorpay order for a token top-up and records it as CREATED.
 * Returns everything the client needs to open Checkout. Tokens are NOT
 * credited here — only after Razorpay confirms payment (webhook or /verify).
 */
const createTopupOrder = async (userId, amountInr) => {
  if (!razorpay.isConfigured()) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, MESSAGES.PAYMENT.NOT_CONFIGURED);
  }
  if (amountInr < PRICING.MIN_TOPUP_INR) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.PAYMENT.MIN_AMOUNT);
  }
  if (amountInr > PRICING.MAX_TOPUP_INR) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.PAYMENT.MAX_AMOUNT);
  }

  const amountPaise = Math.round(amountInr * 100);
  const tokens = amountInr * PRICING.TOKEN_PER_INR;

  // Razorpay caps `receipt` at 40 chars. A full ObjectId (24) + prefix +
  // timestamp overflows that, so use the last 8 chars of the userId plus a
  // base36 timestamp — unique per user per ms and comfortably under 40. The
  // full userId is still recorded in `notes` and on our Payment row.
  const receipt = `topup_${String(userId).slice(-8)}_${Date.now().toString(36)}`;

  let order;
  try {
    order = await razorpay.createOrder({
      amountPaise,
      currency: 'INR',
      receipt,
      notes: { userId: String(userId), tokens: String(tokens) },
    });
  } catch (err) {
    console.error('[Payment] Razorpay order creation failed', err.response?.data || err.message);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, MESSAGES.PAYMENT.ORDER_CREATE_FAILED);
  }

  await Payment.create({
    userId,
    razorpayOrderId: order.id,
    amountPaise,
    currency: 'INR',
    tokens,
    notes: order.notes || null,
  });

  return {
    orderId: order.id,
    amount: amountPaise,
    currency: 'INR',
    tokens,
    razorpayKeyId: razorpay.getKeyId(),
    // Checkout options for the app's WebView. Inside a WebView the JS
    // `handler` callback is unreliable — a UPI intent hands control to the
    // PSP app and the page that would have run the handler is gone — so
    // Checkout has to run in redirect mode instead: Razorpay POSTs the result
    // to `callback_url` (our /wallet/topup/callback) and `webview_intent`
    // lets Checkout fire the UPI intent out to the native app. The client
    // spreads this object straight into its Checkout options.
    checkout: {
      callback_url: razorpay.getCallbackUrl(),
      redirect: true,
      webview_intent: true,
    },
  };
};

/**
 * Credits tokens for a confirmed payment exactly once. Both the webhook and
 * the client /verify path funnel through here; the CREATED→PAID flip is
 * atomic, so whichever arrives first does the work and the other is a no-op.
 */
const creditForPayment = async (payment, { paymentId, signature }) => {
  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, status: PAYMENT_STATUS.CREATED },
    {
      status: PAYMENT_STATUS.PAID,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature || null,
    },
    { new: true }
  );

  if (!claimed) {
    // Already processed by the other path — return current state.
    return Payment.findById(payment._id);
  }

  const txn = await walletService.credit(claimed.userId, claimed.tokens, {
    reason: TXN_REASON.TOPUP,
    referenceType: TXN_REF_TYPE.PAYMENT,
    referenceId: claimed._id,
    idempotencyKey: `payment-${paymentId}`,
    metadata: { orderId: claimed.razorpayOrderId },
  });

  claimed.creditTxnId = txn._id;
  await claimed.save();

  // A successful top-up unlocks any pending referral reward. Non-fatal:
  // never fail the credit because a referral payout had trouble.
  try {
    await referralService.maybeRewardReferral(claimed.userId);
  } catch (err) {
    console.error('[Payment] referral reward failed for', String(claimed._id), err.message);
  }

  return claimed;
};

/**
 * Redirect-mode callback. With `redirect: true` Razorpay does not call the
 * client-side handler — it form-POSTs the result straight to `callback_url`,
 * unauthenticated and from the user's WebView. So there is no req.user here:
 * the order id is the only identifier, and the signature is what proves the
 * payload came from Razorpay. Never throws — the caller has to answer a
 * browser navigation, so every outcome resolves to a status the app can act
 * on. The webhook remains the source of truth if this path is interrupted.
 */
const handleCheckoutCallback = async ({ orderId, paymentId, signature }) => {
  if (!orderId || !paymentId || !signature) {
    // Razorpay posts error[...] fields instead of the success triplet when the
    // payment fails or the user abandons it.
    return { status: 'failed', orderId: orderId || null, paymentId: paymentId || null };
  }

  if (!razorpay.verifyCheckoutSignature({ orderId, paymentId, signature })) {
    console.error('[Payment] callback signature mismatch for order', orderId);
    return { status: 'failed', orderId, paymentId };
  }

  const payment = await Payment.findOne({ razorpayOrderId: orderId });
  if (!payment) {
    console.error('[Payment] callback for unknown order', orderId);
    return { status: 'failed', orderId, paymentId };
  }

  await creditForPayment(payment, { paymentId, signature });

  return { status: 'success', orderId, paymentId };
};

/**
 * Client-side fast-path: verify the checkout signature and credit immediately
 * so the app can show the new balance without waiting for the webhook.
 */
const verifyPayment = async (userId, { orderId, paymentId, signature }) => {
  if (!razorpay.verifyCheckoutSignature({ orderId, paymentId, signature })) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.PAYMENT.SIGNATURE_INVALID);
  }

  const payment = await Payment.findOne({ razorpayOrderId: orderId, userId });
  if (!payment) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.PAYMENT.ORDER_NOT_FOUND);
  }

  const updated = await creditForPayment(payment, { paymentId, signature });
  const balance = await walletService.getBalance(userId);

  return { payment: updated, balance };
};

/**
 * Server-to-server webhook (source of truth). Signature is verified over the
 * RAW body. Always resolves for handled/ignored events so Razorpay doesn't
 * retry indefinitely; a bad signature throws (→ 400) so forged calls fail.
 */
const handleWebhook = async (rawBody, signature) => {
  if (!razorpay.verifyWebhookSignature(rawBody, signature)) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.PAYMENT.SIGNATURE_INVALID);
  }

  const event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  const entity = event.payload?.payment?.entity;

  if (event.event === 'payment.captured' && entity?.order_id) {
    const payment = await Payment.findOne({ razorpayOrderId: entity.order_id });
    if (payment) {
      await creditForPayment(payment, { paymentId: entity.id, signature: null });
    }
  } else if (event.event === 'payment.failed' && entity?.order_id) {
    await Payment.findOneAndUpdate(
      { razorpayOrderId: entity.order_id, status: PAYMENT_STATUS.CREATED },
      { status: PAYMENT_STATUS.FAILED, razorpayPaymentId: entity.id }
    );
  }

  return { event: event.event };
};

module.exports = {
  createTopupOrder,
  handleCheckoutCallback,
  verifyPayment,
  handleWebhook,
};
