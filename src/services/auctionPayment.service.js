const Auction = require('../models/Auction.model');
const Payment = require('../models/Payment.model');
const razorpay = require('./providers/razorpayProvider');
const auctionCloser = require('./auctionCloser.service');
const { PAYMENT_PURPOSE } = require('../constants/entitlementEnums');
const { PAYMENT_STATUS } = require('../constants/walletEnums');
const { AUCTION_STATUS } = require('../constants/auctionEnums');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/* eslint-disable no-console */

/**
 * The winning bidder paying for the device.
 *
 * Order creation only — fulfilment lives in payment.service.js next to the
 * other two purposes, because all three hang off the same atomic CREATED→PAID
 * flip that makes them exactly-once. The Razorpay pipeline, the WebView
 * checkout config and the webhook are all reused unchanged; only the `purpose`
 * differs.
 *
 * NOTE ON SETTLEMENT: this collects from the buyer. It does NOT pay the seller
 * — there is no payout, escrow or commission split in this system. Money lands
 * in the platform's Razorpay account and someone has to move it onwards. See
 * AUCTION_DESIGN.md before turning this on for real sellers.
 */
const createOrder = async (userId, auctionId) => {
  if (!razorpay.isConfigured()) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, MESSAGES.PAYMENT.NOT_CONFIGURED);
  }

  let auction = await Auction.findById(auctionId);
  if (!auction) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);

  // An auction sitting past its end time is settled first, so the winner can
  // pay the moment it closes rather than waiting for the sweeper.
  auction = await auctionCloser.ensureClosed(auction);

  if (auction.status !== AUCTION_STATUS.PAYMENT_PENDING) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.PAYMENT_NOT_DUE);
  }
  if (String(auction.winnerId) !== String(userId)) {
    throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.AUCTION.NOT_WINNER);
  }
  if (auction.paymentDueAt && auction.paymentDueAt <= new Date()) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.PAYMENT_WINDOW_PASSED);
  }

  // Reuse an order the winner already has open. Tapping "Pay" twice should
  // reopen the same checkout, not litter Razorpay with abandoned orders.
  const open = await Payment.findOne({
    auctionId: auction._id,
    userId,
    purpose: PAYMENT_PURPOSE.AUCTION,
    status: PAYMENT_STATUS.CREATED,
  });

  if (open) {
    return {
      orderId: open.razorpayOrderId,
      amount: open.amountPaise,
      currency: open.currency,
      auctionId: String(auction._id),
      razorpayKeyId: razorpay.getKeyId(),
      checkout: razorpay.getCheckoutOptions(),
      reused: true,
    };
  }

  // Razorpay caps `receipt` at 40 characters — same budget as the other two.
  const receipt = `auc_${String(auction._id).slice(-8)}_${Date.now().toString(36)}`;

  let order;
  try {
    order = await razorpay.createOrder({
      amountPaise: auction.currentBidPaise,
      currency: 'INR',
      receipt,
      notes: {
        userId: String(userId),
        purpose: PAYMENT_PURPOSE.AUCTION,
        auctionId: String(auction._id),
      },
    });
  } catch (err) {
    console.error('[Auction] Razorpay order creation failed', err.response?.data || err.message);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, MESSAGES.PAYMENT.ORDER_CREATE_FAILED);
  }

  const payment = await Payment.create({
    userId,
    razorpayOrderId: order.id,
    amountPaise: auction.currentBidPaise,
    currency: 'INR',
    purpose: PAYMENT_PURPOSE.AUCTION,
    tokens: 0,
    auctionId: auction._id,
    notes: order.notes || null,
  });

  await Auction.updateOne({ _id: auction._id }, { paymentId: payment._id });

  return {
    orderId: order.id,
    amount: auction.currentBidPaise,
    currency: 'INR',
    auctionId: String(auction._id),
    razorpayKeyId: razorpay.getKeyId(),
    checkout: razorpay.getCheckoutOptions(),
    reused: false,
  };
};

module.exports = { createOrder };
