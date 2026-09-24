const Auction = require('../models/Auction.model');
const Payment = require('../models/Payment.model');
const razorpay = require('./providers/razorpayProvider');
const Bid = require('../models/Bid.model');
const auctionCloser = require('./auctionCloser.service');
const orderService = require('./order.service');
const settingsService = require('./settings.service');
const notificationService = require('./notification.service');
const { SETTING_KEYS } = require('../constants/settings');
const { NOTIFICATION_TYPE } = require('../constants/notification');
const { PAYMENT_PURPOSE } = require('../constants/entitlementEnums');
const { PAYMENT_STATUS } = require('../constants/walletEnums');
const {
  AUCTION_STATUS,
  ORDER_SOURCE,
  BID_STATUS,
} = require('../constants/auctionEnums');
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

/**
 * Instant purchase. Ends the auction there and then at the seller's Buy Now
 * price; the buyer pays inside their own window like any winner.
 *
 * The claim below is the same atomic conditional update bidding uses, and it
 * has to be: two people hitting Buy Now in the same instant must not both end
 * up owning the device, and it must not be possible to buy at a price bidding
 * has already passed. `$expr` compares against the document's own live values
 * at write time, so exactly one caller can win.
 *
 * TRADE-OFF, RECORDED DELIBERATELY: clicking this takes the device off the
 * market for the whole payment window at no cost to the clicker, and unlike a
 * lapsed auction win there are no underlying bidders to fall back on — the
 * listing simply has to be relisted. That is why the Buy Now window is its own
 * setting, separate from the bidding one: shorten it if people start reserving
 * stock they never pay for.
 */
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
  if (auction.status !== AUCTION_STATUS.LIVE) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.NOT_LIVE);
  }
  if (!auction.buyNowPricePaise) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.NO_BUY_NOW);
  }

  const windowHours = await settingsService.get(SETTING_KEYS.AUCTION_BUY_NOW_WINDOW_HOURS);
  const now = new Date();
  const dueAt = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

  const claimed = await Auction.findOneAndUpdate(
    {
      _id: auction._id,
      status: AUCTION_STATUS.LIVE,
      endAt: { $gt: now },
      buyNowPricePaise: { $ne: null },
      // Selling at the instant price once bidding has passed it would be
      // selling below the book.
      $expr: {
        $or: [
          { $eq: [{ $ifNull: ['$currentBidPaise', null] }, null] },
          { $lt: ['$currentBidPaise', '$buyNowPricePaise'] },
        ],
      },
    },
    [
      {
        $set: {
          status: AUCTION_STATUS.PAYMENT_PENDING,
          winnerId: userId,
          // A Buy Now has no winning bid — the price came from the listing.
          winningBidId: null,
          salePricePaise: '$buyNowPricePaise',
          closedAt: now,
          paymentDueAt: dueAt,
        },
      },
    ],
    { new: true }
  );

  if (!claimed) {
    const fresh = await Auction.findById(auction._id).lean();
    // Say which of the two things went wrong, so the app can either refresh the
    // price or tell the buyer it is gone.
    if (fresh && fresh.currentBidPaise >= fresh.buyNowPricePaise) {
      throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.BUY_NOW_PASSED);
    }
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.NOT_LIVE);
  }

  // Everyone who bid has lost — the device went to an instant buyer.
  const losers = await Bid.distinct('bidderId', { auctionId: claimed._id });
  await Bid.updateMany({ auctionId: claimed._id }, { status: BID_STATUS.LOST });

  const salesOrder = await orderService.createForAuction(claimed, userId, {
    source: ORDER_SOURCE.BUY_NOW,
    amountPaise: claimed.salePricePaise,
    shippingAddress,
  });

  const receipt = `aucbn_${String(claimed._id).slice(-8)}_${Date.now().toString(36)}`;

  let order;
  try {
    order = await razorpay.createOrder({
      amountPaise: claimed.salePricePaise,
      currency: 'INR',
      receipt,
      notes: {
        userId: String(userId),
        purpose: PAYMENT_PURPOSE.AUCTION,
        auctionId: String(claimed._id),
        source: ORDER_SOURCE.BUY_NOW,
      },
    });
  } catch (err) {
    console.error('[Auction] Buy Now order creation failed', err.response?.data || err.message);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, MESSAGES.PAYMENT.ORDER_CREATE_FAILED);
  }

  const payment = await Payment.create({
    userId,
    razorpayOrderId: order.id,
    amountPaise: claimed.salePricePaise,
    currency: 'INR',
    purpose: PAYMENT_PURPOSE.AUCTION,
    tokens: 0,
    auctionId: claimed._id,
    notes: order.notes || null,
  });

  await Auction.updateOne({ _id: claimed._id }, { paymentId: payment._id });

  const label = `${claimed.device?.brand || ''} ${claimed.device?.model || ''}`.trim() || 'a device';

  await Promise.all(
    losers
      .filter((id) => String(id) !== String(userId))
      .map(async (id) => {
        try {
          await notificationService.notifyUser(id, {
            title: 'Auction ended early',
            body: `${label} was bought instantly by another buyer.`,
            type: NOTIFICATION_TYPE.AUCTION,
            data: { auctionId: String(claimed._id), outcome: BID_STATUS.LOST },
          });
        } catch (err) {
          console.error('[Auction] buy-now loser notification failed', err.message);
        }
      })
  );

  return {
    orderId: order.id,
    amount: claimed.salePricePaise,
    currency: 'INR',
    auctionId: String(claimed._id),
    salesOrderId: String(salesOrder._id),
    paymentDueAt: dueAt,
    razorpayKeyId: razorpay.getKeyId(),
    checkout: razorpay.getCheckoutOptions(),
  };
};

module.exports = { createOrder, buyNow };
