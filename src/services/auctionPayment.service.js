const Auction = require('../models/Auction.model');
const Payment = require('../models/Payment.model');
const razorpay = require('./providers/razorpayProvider');
const auctionCloser = require('./auctionCloser.service');
const orderService = require('./order.service');
const settingsService = require('./settings.service');
const { SETTING_KEYS } = require('../constants/settings');
const { PAYMENT_PURPOSE } = require('../constants/entitlementEnums');
const { PAYMENT_STATUS } = require('../constants/walletEnums');
const { AUCTION_STATUS, ORDER_SOURCE } = require('../constants/auctionEnums');
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
const createOrder = async (userId, auctionId, { shippingAddress = null } = {}) => {
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
  if (auction.buyNowReservation || !auction.winningBidId) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.PAYMENT_NOT_DUE);
  }
  if (auction.paymentDueAt && auction.paymentDueAt <= new Date()) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.PAYMENT_WINDOW_PASSED);
  }

  // The stored sale price, NOT `currentBidPaise`. After a second-chance offer
  // the holder is a lower bidder paying their own bid, and the top of the book
  // still shows the bid of someone who never paid. `salePricePaise` is also
  // what a Buy Now writes, so both routes to owning the device price the same
  // way. Legacy rows written before this field existed fall back to the top
  // bid, which was the sale price for those.
  const amountPaise = auction.salePricePaise ?? auction.currentBidPaise;

  if (!amountPaise || amountPaise <= 0) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.PAYMENT_NOT_DUE);
  }

  // The order — and with it the delivery address — is recorded BEFORE any
  // money moves. Taking payment for a device with nowhere to send it is how a
  // sale becomes a support ticket.
  const salesOrder = await orderService.createForAuction(auction, userId, {
    source: ORDER_SOURCE.AUCTION_WIN,
    amountPaise,
    bidId: auction.winningBidId,
    shippingAddress,
  });

  if (!salesOrder.shippingAddress) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.ORDER.ADDRESS_REQUIRED, [
      { field: 'shippingAddress', message: MESSAGES.ORDER.ADDRESS_REQUIRED },
    ]);
  }

  // Reuse an order the winner already has open. Tapping "Pay" twice should
  // reopen the same checkout, not litter Razorpay with abandoned orders.
  const open = await Payment.findOne({
    auctionId: auction._id,
    userId,
    purpose: PAYMENT_PURPOSE.AUCTION,
    status: PAYMENT_STATUS.CREATED,
    'notes.source': { $ne: ORDER_SOURCE.BUY_NOW },
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
      amountPaise,
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
    amountPaise,
    currency: 'INR',
    purpose: PAYMENT_PURPOSE.AUCTION,
    tokens: 0,
    auctionId: auction._id,
    notes: order.notes || null,
  });

  await Auction.updateOne({ _id: auction._id }, { paymentId: payment._id });

  return {
    orderId: order.id,
    amount: amountPaise,
    currency: 'INR',
    auctionId: String(auction._id),
    razorpayKeyId: razorpay.getKeyId(),
    checkout: razorpay.getCheckoutOptions(),
    reused: false,
  };
};

/** Atomically reserves the listing for the first buyer to start checkout. */
const buyNow = async (userId, auctionId, { shippingAddress = null } = {}) => {
  if (!razorpay.isConfigured()) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, MESSAGES.PAYMENT.NOT_CONFIGURED);
  }
  if (!shippingAddress) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.ORDER.ADDRESS_REQUIRED, [
      { field: 'shippingAddress', message: MESSAGES.ORDER.ADDRESS_REQUIRED },
    ]);
  }

  let auction = await Auction.findById(auctionId);
  if (!auction) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);

  auction = await auctionCloser.ensureClosed(auction);

  if (String(auction.sellerId) === String(userId)) {
    throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.BID.OWN_AUCTION);
  }

  if (
    auction.status === AUCTION_STATUS.PAYMENT_PENDING &&
    auction.buyNowReservation &&
    String(auction.winnerId) === String(userId) &&
    auction.paymentDueAt > new Date()
  ) {
    const open = await Payment.findOne({
      auctionId: auction._id,
      userId,
      purpose: PAYMENT_PURPOSE.AUCTION,
      status: PAYMENT_STATUS.CREATED,
      'notes.source': ORDER_SOURCE.BUY_NOW,
      'notes.reserved': true,
    });
    if (open) {
      const salesOrder = await orderService.createForAuction(auction, userId, {
        source: ORDER_SOURCE.BUY_NOW,
        amountPaise: open.amountPaise,
        shippingAddress,
      });
      return {
        orderId: open.razorpayOrderId,
        amount: open.amountPaise,
        currency: open.currency,
        auctionId: String(auction._id),
        salesOrderId: String(salesOrder._id),
        razorpayKeyId: razorpay.getKeyId(),
        checkout: razorpay.getCheckoutOptions(),
        reused: true,
      };
    }
  }

  if (auction.status !== AUCTION_STATUS.LIVE) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.NOT_LIVE);
  }
  if (!auction.buyNowPricePaise) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.NO_BUY_NOW);
  }
  // Selling at the instant price once bidding has passed it would be selling
  // below the book. The atomic reservation below repeats this check against the
  // latest bid so a concurrent bid cannot slip through.
  if (auction.currentBidPaise != null && auction.currentBidPaise >= auction.buyNowPricePaise) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.BUY_NOW_PASSED);
  }
  if (auction.endAt - new Date() < 2 * 60 * 1000) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.BUY_NOW_CLOSING_SOON);
  }

  const salePricePaise = auction.buyNowPricePaise;
  const now = new Date();
  const buyNowWindowMinutes = await settingsService.get(SETTING_KEYS.AUCTION_BUY_NOW_WINDOW_MINUTES);
  const reserved = await Auction.findOneAndUpdate(
    {
      _id: auction._id,
      status: AUCTION_STATUS.LIVE,
      startAt: { $lte: now },
      endAt: { $gt: new Date(now.getTime() + 2 * 60 * 1000) },
      buyNowPricePaise: salePricePaise,
      $expr: {
        $or: [
          { $eq: [{ $ifNull: ['$currentBidPaise', null] }, null] },
          { $lt: ['$currentBidPaise', '$buyNowPricePaise'] },
        ],
      },
    },
    {
      $set: {
        status: AUCTION_STATUS.PAYMENT_PENDING,
        winnerId: userId,
        winningBidId: null,
        salePricePaise,
        closedAt: now,
        paymentDueAt: new Date(now.getTime() + buyNowWindowMinutes * 60 * 1000),
        buyNowReservation: true,
        paymentId: null,
      },
    },
    { new: true }
  );
  if (!reserved) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.NOT_LIVE);
  }

  let salesOrder;
  let payment;
  try {
    salesOrder = await orderService.createForAuction(reserved, userId, {
      source: ORDER_SOURCE.BUY_NOW,
      amountPaise: salePricePaise,
      shippingAddress,
    });

    const receipt = `aucbn_${String(reserved._id).slice(-8)}_${Date.now().toString(36)}`;
    const order = await razorpay.createOrder({
      amountPaise: salePricePaise,
      currency: 'INR',
      receipt,
      notes: {
        userId: String(userId),
        purpose: PAYMENT_PURPOSE.AUCTION,
        auctionId: String(reserved._id),
        source: ORDER_SOURCE.BUY_NOW,
        reserved: true,
      },
    });

    payment = await Payment.create({
      userId,
      razorpayOrderId: order.id,
      amountPaise: salePricePaise,
      currency: 'INR',
      purpose: PAYMENT_PURPOSE.AUCTION,
      tokens: 0,
      auctionId: reserved._id,
      notes: order.notes || null,
    });

    const attached = await Auction.updateOne(
      {
        _id: reserved._id,
        status: AUCTION_STATUS.PAYMENT_PENDING,
        buyNowReservation: true,
        winnerId: userId,
        paymentId: null,
      },
      { $set: { paymentId: payment._id } }
    );
    if (!attached.modifiedCount) {
      throw new Error('Buy Now reservation changed before payment was attached.');
    }
  } catch (err) {
    console.error('[Auction] Buy Now checkout creation failed', err.response?.data || err.message);
    if (payment) {
      await Payment.updateOne(
        { _id: payment._id, status: PAYMENT_STATUS.CREATED },
        { $set: { status: PAYMENT_STATUS.FAILED } }
      );
    }
    await orderService.cancelUnpaidForBuyer(reserved._id, userId);
    await Auction.updateOne(
      {
        _id: reserved._id,
        status: AUCTION_STATUS.PAYMENT_PENDING,
        buyNowReservation: true,
        winnerId: userId,
        paymentId: payment ? payment._id : null,
      },
      {
        $set: {
          status: AUCTION_STATUS.LIVE,
          winnerId: null,
          winningBidId: null,
          salePricePaise: null,
          closedAt: null,
          paymentDueAt: null,
          buyNowReservation: false,
          paymentId: null,
        },
      }
    );
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, MESSAGES.PAYMENT.ORDER_CREATE_FAILED);
  }

  return {
    orderId: payment.razorpayOrderId,
    amount: salePricePaise,
    currency: 'INR',
    auctionId: String(reserved._id),
    salesOrderId: String(salesOrder._id),
    razorpayKeyId: razorpay.getKeyId(),
    checkout: razorpay.getCheckoutOptions(),
  };
};

module.exports = { createOrder, buyNow };
