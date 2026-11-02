const VendorPayment = require('../models/VendorPayment.model');
const razorpay = require('./providers/razorpayProvider');
const vendorLicenceService = require('./vendorLicence.service');
const settingsService = require('./settings.service');
const { SETTING_KEYS } = require('../constants/settings');
const { PAYMENT_STATUS } = require('../constants/walletEnums');
const { VENDOR_TXN_REASON, VENDOR_REF_TYPE } = require('../constants/vendorEnums');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/* eslint-disable no-console */

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 100000;

/**
 * Creates a Razorpay order for a licence purchase.
 * Returns everything the vendor needs to open Checkout.
 * Licences are NOT credited here — only after payment is confirmed.
 */
const createOrder = async (vendorId, { quantity }) => {
  if (!razorpay.isConfigured()) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, MESSAGES.PAYMENT.NOT_CONFIGURED);
  }

  const qty = parseInt(quantity, 10);
  if (!Number.isInteger(qty) || qty < MIN_QUANTITY || qty > MAX_QUANTITY) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.VENDOR.INVALID_QUANTITY, [
      { field: 'quantity', message: `Quantity must be between ${MIN_QUANTITY} and ${MAX_QUANTITY}.` },
    ]);
  }

  const pricePerLicencePaise = await settingsService.get(SETTING_KEYS.VENDOR_LICENCE_PRICE_PAISE);
  const amountPaise = qty * pricePerLicencePaise;

  const receipt = `vlic_${String(vendorId).slice(-8)}_${Date.now().toString(36)}`;

  let order;
  try {
    order = await razorpay.createOrder({
      amountPaise,
      currency: 'INR',
      receipt,
      notes: {
        vendorId: String(vendorId),
        licences: String(qty),
        pricePerLicencePaise: String(pricePerLicencePaise),
      },
    });
  } catch (err) {
    console.error('[VendorPayment] Razorpay order creation failed', err.response?.data || err.message);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, MESSAGES.PAYMENT.ORDER_CREATE_FAILED);
  }

  await VendorPayment.create({
    vendorId,
    razorpayOrderId: order.id,
    amountPaise,
    currency: 'INR',
    licences: qty,
    notes: order.notes || null,
  });

  return {
    orderId: order.id,
    amount: amountPaise,
    currency: 'INR',
    licences: qty,
    pricePerLicencePaise,
    razorpayKeyId: razorpay.getKeyId(),
    checkout: razorpay.getCheckoutOptions(),
  };
};

/**
 * Fulfils a confirmed payment exactly once. CREATED→PAID flip is atomic.
 * Credits licences to the vendor after the flip succeeds.
 */
const creditForPayment = async (payment, { paymentId, signature }) => {
  const claimed = await VendorPayment.findOneAndUpdate(
    { _id: payment._id, status: PAYMENT_STATUS.CREATED },
    {
      status: PAYMENT_STATUS.PAID,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature || null,
    },
    { new: true }
  );

  if (!claimed) return VendorPayment.findById(payment._id);

  await vendorLicenceService.credit(claimed.vendorId, claimed.licences, {
    reason: VENDOR_TXN_REASON.PURCHASE,
    referenceType: VENDOR_REF_TYPE.PAYMENT,
    idempotencyKey: `vp-${paymentId}`,
    note: `Razorpay order ${claimed.razorpayOrderId}`,
  });

  return claimed;
};

/**
 * Client-side verify: checks the Razorpay signature and credits immediately.
 */
const verifyPayment = async (vendorId, { orderId, paymentId, signature }) => {
  if (!razorpay.verifyCheckoutSignature({ orderId, paymentId, signature })) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.PAYMENT.SIGNATURE_INVALID);
  }

  const payment = await VendorPayment.findOne({ razorpayOrderId: orderId, vendorId });
  if (!payment) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.PAYMENT.ORDER_NOT_FOUND);
  }

  return creditForPayment(payment, { paymentId, signature });
};

/**
 * Webhook entry point. Called from payment.service.js handleWebhook when the
 * order belongs to a vendor rather than a user.
 */
const handleWebhookEvent = async (entity, event) => {
  const payment = await VendorPayment.findOne({ razorpayOrderId: entity.order_id });
  if (!payment) return;

  if (event === 'payment.captured') {
    await creditForPayment(payment, { paymentId: entity.id, signature: null });
  } else if (event === 'payment.failed') {
    await VendorPayment.findOneAndUpdate(
      { razorpayOrderId: entity.order_id, status: PAYMENT_STATUS.CREATED },
      { status: PAYMENT_STATUS.FAILED, razorpayPaymentId: entity.id }
    );
  }
};

module.exports = { createOrder, creditForPayment, verifyPayment, handleWebhookEvent };
