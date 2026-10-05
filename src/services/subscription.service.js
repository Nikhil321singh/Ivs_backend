const Payment = require('../models/Payment.model');
const razorpay = require('./providers/razorpayProvider');
const planService = require('./plan.service');
const settingsService = require('./settings.service');
const { PAYMENT_PURPOSE, PLAN_TIER } = require('../constants/entitlementEnums');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/* eslint-disable no-console */

/**
 * Buying a credit pack. Order creation only — fulfilment lives in
 * payment.service.js alongside the token-wallet credit, because both hang off
 * the same atomic CREATED→PAID flip that makes them exactly-once.
 *
 * Razorpay's minimum order is ₹1. A pack priced below that is a
 * misconfiguration, not a free plan: free access is granted with an admin
 * credit adjustment, not by charging nothing.
 */
const MIN_ORDER_PAISE = 100;

/**
 * Freeze what is being sold. For a catalogue plan this comes from the Plan row;
 * for a custom pack it comes from the pricing formula, which is the only place
 * a custom price is ever decided — the client sends quantities, never a price.
 */
const buildSnapshot = async ({ planCode, custom }) => {
  const isCustom =
    !planCode || String(planCode).toUpperCase() === PLAN_TIER.CUSTOM;

  if (isCustom) {
    const quote = await planService.quoteCustom(custom || {});

    return {
      planId: null,
      snapshot: {
        code: PLAN_TIER.CUSTOM,
        name: quote.name,
        tier: PLAN_TIER.CUSTOM,
        quotas: quote.quotas,
        pricePaise: quote.pricePaise,
        discountPercent: quote.discountPercent,
      },
    };
  }

  const plan = await planService.getActiveByCode(planCode);
  const settings = await settingsService.getAll();
  const decorated = planService.decorate(plan, settings);

  return {
    planId: plan._id,
    snapshot: {
      code: decorated.code,
      name: decorated.name,
      tier: decorated.tier,
      quotas: decorated.quotas,
      pricePaise: decorated.pricePaise,
      discountPercent: decorated.discountPercent,
    },
  };
};

/**
 * Creates a Razorpay order for a credit pack and records it as CREATED.
 * Returns everything the client needs to open Checkout. Credits are NOT granted
 * here — only after Razorpay confirms payment (webhook, /verify or /callback).
 */
const createOrder = async (userId, { planCode = null, custom = null } = {}) => {
  if (!razorpay.isConfigured()) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, MESSAGES.PAYMENT.NOT_CONFIGURED);
  }

  const { planId, snapshot } = await buildSnapshot({ planCode, custom });

  if (!snapshot.pricePaise || snapshot.pricePaise < MIN_ORDER_PAISE) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.PAYMENT.MIN_AMOUNT);
  }

  // Razorpay caps `receipt` at 40 chars — same budget as the top-up receipt.
  const receipt = `plan_${String(userId).slice(-8)}_${Date.now().toString(36)}`;

  let order;
  try {
    order = await razorpay.createOrder({
      amountPaise: snapshot.pricePaise,
      currency: 'INR',
      receipt,
      notes: {
        userId: String(userId),
        purpose: PAYMENT_PURPOSE.PLAN,
        planCode: snapshot.code,
      },
    });
  } catch (err) {
    console.error('[Subscription] Razorpay order creation failed', err.response?.data || err.message);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, MESSAGES.PAYMENT.ORDER_CREATE_FAILED);
  }

  await Payment.create({
    userId,
    razorpayOrderId: order.id,
    amountPaise: snapshot.pricePaise,
    currency: 'INR',
    purpose: PAYMENT_PURPOSE.PLAN,
    tokens: 0,
    planId,
    planSnapshot: snapshot,
    notes: order.notes || null,
  });

  return {
    orderId: order.id,
    amount: snapshot.pricePaise,
    currency: 'INR',
    plan: snapshot,
    razorpayKeyId: razorpay.getKeyId(),
    checkout: razorpay.getCheckoutOptions(),
  };
};

/** The caller's pack purchases, newest first. */
const listPurchases = async (userId, { page = 1, limit = 20 } = {}) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const filter = { userId, purpose: PAYMENT_PURPOSE.PLAN };

  const [items, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
    Payment.countDocuments(filter),
  ]);

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
    },
  };
};

module.exports = {
  createOrder,
  listPurchases,
};
