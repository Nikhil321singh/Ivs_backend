const Payment = require('../models/Payment.model');
const Auction = require('../models/Auction.model');
const razorpay = require('./providers/razorpayProvider');
const walletService = require('./wallet.service');
const entitlementService = require('./entitlement.service');
const auctionSale = require('./auctionSale.service');
const referralService = require('./referral.service');
const PRICING = require('../constants/pricing');
const settingsService = require('./settings.service');
const { SETTING_KEYS } = require('../constants/settings');
const { BILLING_MODE } = require('../constants/entitlementEnums');
const { PAYMENT_STATUS, TXN_REASON, TXN_REF_TYPE } = require('../constants/walletEnums');
const {
  PAYMENT_PURPOSE,
  ENTITLEMENT_REASON,
  ENTITLEMENT_REF_TYPE,
} = require('../constants/entitlementEnums');
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

  // In SUBSCRIPTION mode nothing spends tokens, so selling them would take
  // money for something the customer cannot use. WALLET and BOTH still sell —
  // BOTH is the cutover mode, where tokens remain spendable as a fallback.
  if ((await settingsService.get(SETTING_KEYS.BILLING_MODE)) === BILLING_MODE.SUBSCRIPTION) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.PAYMENT.TOPUP_DISABLED);
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
    checkout: razorpay.getCheckoutOptions(),
  };
};

/**
 * Fulfils a confirmed payment exactly once. Both the webhook and the client
 * /verify path funnel through here; the CREATED→PAID flip is atomic, so
 * whichever arrives first does the work and the other is a no-op.
 *
 * What "fulfil" means depends on what was bought: a PLAN grants credits from
 * the snapshot frozen at order time, a TOPUP credits tokens to the wallet, and
 * an AUCTION completes a sale between two users.
 *
 * The referral payout that follows applies to PLAN and TOPUP only. An auction
 * payment is a buyer paying a seller, not a purchase from us, so it must not
 * trigger a reward — and it must not credit anything to the payer's wallet.
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

  if (claimed.purpose === PAYMENT_PURPOSE.AUCTION) {
    // A sale between two users. Nothing is credited to anyone's balance — the
    // auction simply becomes SOLD, and both sides are told.
    await auctionSale.completeSale(claimed);
    return claimed;
  }

  if (claimed.purpose === PAYMENT_PURPOSE.PLAN) {
    // Credit what was sold, not what the plan says today — an admin may have
    // repriced or re-quota'd it between checkout and capture.
    const quotas = claimed.planSnapshot?.quotas
      ? Object.fromEntries(claimed.planSnapshot.quotas)
      : {};

    await entitlementService.creditPack(claimed.userId, quotas, {
      reason: ENTITLEMENT_REASON.PLAN_PURCHASE,
      referenceType: ENTITLEMENT_REF_TYPE.PAYMENT,
      referenceId: claimed._id,
      // creditPack suffixes this per feature, so a two-feature pack replayed by
      // a duplicate webhook still grants each feature exactly once.
      idempotencyKey: `payment-${paymentId}`,
      metadata: { orderId: claimed.razorpayOrderId, planCode: claimed.planSnapshot?.code },
    });

    // `creditTxnId` intentionally stays null: it references a WalletTransaction
    // and a pack writes one EntitlementTransaction per feature, so there is no
    // single row to point at. Those rows carry referenceId → this Payment,
    // which is the durable link in the direction that actually gets queried.
  } else {
    const txn = await walletService.credit(claimed.userId, claimed.tokens, {
      reason: TXN_REASON.TOPUP,
      referenceType: TXN_REF_TYPE.PAYMENT,
      referenceId: claimed._id,
      idempotencyKey: `payment-${paymentId}`,
      metadata: { orderId: claimed.razorpayOrderId },
    });

    claimed.creditTxnId = txn._id;
    await claimed.save();
  }

  // A successful purchase — pack or top-up — unlocks any pending referral
  // reward. Non-fatal: never fail the fulfilment because a payout had trouble.
  // This is also why the referral programme survives the move to credit packs:
  // with top-ups switched off, a pack purchase is the qualifying event.
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

  if (updated.purpose === PAYMENT_PURPOSE.PLAN) {
    const { credits } = await entitlementService.getSummary(userId);
    return { payment: updated, credits };
  }

  if (updated.purpose === PAYMENT_PURPOSE.AUCTION) {
    // Nothing was credited to a balance — the useful answer is the sale itself.
    const auction = await Auction.findById(updated.auctionId).lean();
    return {
      payment: updated,
      auction: auction ? { id: String(auction._id), status: auction.status } : null,
    };
  }

  return { payment: updated, balance: await walletService.getBalance(userId) };
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
