const Auction = require('../models/Auction.model');
const Bid = require('../models/Bid.model');
const notificationService = require('./notification.service');
const orderService = require('./order.service');
const { NOTIFICATION_TYPE } = require('../constants/notification');
const { AUCTION_STATUS, BID_STATUS, ORDER_SOURCE } = require('../constants/auctionEnums');

/* eslint-disable no-console */

/**
 * Completing an auction sale once the winner's payment is captured.
 *
 * Kept in its own small module so payment.service.js can dispatch to it without
 * pulling in the whole auction stack — and so the dependency runs one way only
 * (payment → sale → models), with no cycle back.
 */

const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN')}`;

const notifySafely = async (userId, payload) => {
  if (!userId) return;
  try {
    await notificationService.notifyUser(userId, { ...payload, type: NOTIFICATION_TYPE.AUCTION });
  } catch (err) {
    console.error('[Auction] sale notification failed', String(userId), err.message);
  }
};

const isBuyNow = (payment) => payment?.notes?.source === ORDER_SOURCE.BUY_NOW;

/**
 * A Buy Now payment was captured but the device can no longer be sold to this
 * buyer — another buyer's payment landed first, bidding passed the instant
 * price, or the auction ended before the money arrived. Refund automatically and
 * cancel the unpaid order we opened at click time.
 */
const refundLostBuyNow = async (payment) => {
  console.error(
    '[Auction] buy-now payment captured but device unavailable — manual refund required',
    'auction:', String(payment.auctionId),
    'paymentId:', String(payment._id),
    'razorpayPaymentId:', payment.razorpayPaymentId || 'not set'
  );

  try {
    await orderService.cancelUnpaidForBuyer(payment.auctionId, payment.userId);
  } catch (err) {
    console.error('[Auction] could not cancel unpaid buy-now order', String(payment._id), err.message);
  }

  await notifySafely(payment.userId, {
    title: 'Buy Now could not be completed',
    body: 'This device was no longer available. Our team will reach out to process your refund.',
    data: { auctionId: String(payment.auctionId), outcome: 'REFUNDED' },
  });
};

/**
 * Claims the auction for the payer at capture time.
 *
 * Two shapes:
 *  - Buy Now: the auction was left LIVE at click time, so this is where it is
 *    actually taken off the market. The claim is atomic and re-checks every
 *    eligibility rule (still live, not ended, instant price not passed by
 *    bidding), so the FIRST captured payment wins and any second one falls
 *    through to a refund. Everyone who bid then loses.
 *  - Auction win: the auction is already PAYMENT_PENDING (the bidder won when it
 *    ended). The transition is conditional on that, so a replayed webhook cannot
 *    re-run the sale and a payment landing after the window lapsed cannot
 *    resurrect an auction the sweeper already expired.
 */
const completeSale = async (payment) => {
  if (!payment.auctionId) return null;

  const now = new Date();
  let sold;

  if (isBuyNow(payment)) {
    sold = await Auction.findOneAndUpdate(
      {
        _id: payment.auctionId,
        status: AUCTION_STATUS.LIVE,
        endAt: { $gt: now },
        buyNowPricePaise: { $ne: null },
      },
      [
        {
          $set: {
            status: AUCTION_STATUS.SOLD,
            winnerId: payment.userId,
            // A Buy Now has no winning bid — the price came from the listing.
            winningBidId: null,
            salePricePaise: '$buyNowPricePaise',
            soldAt: now,
            closedAt: now,
            paymentId: payment._id,
          },
        },
      ],
      { new: true }
    );

    // Fallback: the sweeper may have closed the auction between checkout and
    // capture. The buyer's money is already captured — if no competing payment
    // has completed, this captured payment takes priority over an unpaid window.
    if (!sold) {
      sold = await Auction.findOneAndUpdate(
        {
          _id: payment.auctionId,
          buyNowPricePaise: { $ne: null },
          $or: [
            // Expired in the DB but sweeper hasn't run yet (up to 30-sec window).
            { status: AUCTION_STATUS.LIVE, endAt: { $lte: now } },
            { status: { $in: [AUCTION_STATUS.ENDED_NO_BIDS, AUCTION_STATUS.PAYMENT_EXPIRED] } },
            // PAYMENT_PENDING with no current winner: the previous winner's window
            // lapsed and passOfferDown cleared winnerId before finding the next
            // candidate. Safe to take — nobody has been told they won yet.
            { status: AUCTION_STATUS.PAYMENT_PENDING, winnerId: null },
          ],
        },
        [
          {
            $set: {
              status: AUCTION_STATUS.SOLD,
              winnerId: payment.userId,
              winningBidId: null,
              salePricePaise: '$buyNowPricePaise',
              soldAt: now,
              closedAt: { $ifNull: ['$closedAt', now] },
              paymentId: payment._id,
            },
          },
        ],
        { new: true }
      );
    }

    if (!sold) {
      // Guard: if this payment already completed the sale (duplicate webhook /
      // verify race), the auction is SOLD with our paymentId — nothing to do.
      const current = await Auction.findById(payment.auctionId);
      if (
        current?.status === AUCTION_STATUS.SOLD &&
        String(current.paymentId) === String(payment._id)
      ) {
        return current;
      }
      await refundLostBuyNow(payment);
      return current;
    }

    // The device went to an instant buyer — everyone who bid has lost.
    await Bid.updateMany({ auctionId: sold._id }, { status: BID_STATUS.LOST });
    const losers = await Bid.distinct('bidderId', { auctionId: sold._id });
    const label = `${sold.device?.brand || ''} ${sold.device?.model || ''}`.trim() || 'a device';
    await Promise.all(
      losers
        .filter((id) => String(id) !== String(payment.userId))
        .map((id) =>
          notifySafely(id, {
            title: 'Auction ended early',
            body: `${label} was bought instantly by another buyer.`,
            data: { auctionId: String(sold._id), outcome: BID_STATUS.LOST },
          })
        )
    );
  } else {
    sold = await Auction.findOneAndUpdate(
      {
        _id: payment.auctionId,
        status: { $in: [AUCTION_STATUS.PAYMENT_PENDING, AUCTION_STATUS.PAYMENT_EXPIRED] },
      },
      {
        status: AUCTION_STATUS.SOLD,
        winnerId: payment.userId,
        soldAt: now,
        paymentId: payment._id,
      },
      { new: true }
    );

    if (!sold) {
      // Either already sold (a duplicate webhook) or cancelled. The buyer has
      // paid for something the system no longer considers for sale.
      const current = await Auction.findById(payment.auctionId);
      if (current && current.status !== AUCTION_STATUS.SOLD) {
        console.error(
          '[Auction] payment captured for an auction that is not payable',
          String(payment.auctionId),
          'status:',
          current.status,
          'paymentId:',
          String(payment._id)
        );
      }
      return current;
    }
  }

  // The order carries the delivery address and drives fulfilment from here on.
  // Non-fatal: the auction is already SOLD and the money already taken, so a
  // failure here must not undo the sale — it leaves an order to reconcile,
  // which the admin orders screen surfaces.
  try {
    // Keyed on the buyer too: a Buy Now race can leave a losing buyer's unpaid
    // order on the same auction, and only the payer's order must be marked paid.
    await orderService.markPaid(sold._id, payment.userId, payment._id);
  } catch (err) {
    console.error('[Auction] could not mark order paid', String(sold._id), err.message);
  }

  const label = `${sold.device?.brand || ''} ${sold.device?.model || ''}`.trim() || 'the device';

  await Promise.all([
    notifySafely(sold.sellerId, {
      title: 'Your auction has been paid for',
      body: `The buyer paid ${rupees(sold.salePricePaise ?? sold.currentBidPaise)} for ${label}. Arrange handover with them now.`,
      data: { auctionId: String(sold._id), outcome: AUCTION_STATUS.SOLD },
    }),
    notifySafely(sold.winnerId, {
      title: 'Payment received',
      body: `You paid ${rupees(sold.salePricePaise ?? sold.currentBidPaise)} for ${label}. The seller has been notified.`,
      data: { auctionId: String(sold._id), outcome: AUCTION_STATUS.SOLD },
    }),
  ]);

  return sold;
};

module.exports = { completeSale };
