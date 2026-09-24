const Auction = require('../models/Auction.model');
const notificationService = require('./notification.service');
const orderService = require('./order.service');
const { NOTIFICATION_TYPE } = require('../constants/notification');
const { AUCTION_STATUS } = require('../constants/auctionEnums');

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

/**
 * Marks the auction SOLD. The status transition is conditional on it still
 * being PAYMENT_PENDING, so a replayed webhook cannot re-run the sale, and a
 * payment that lands microseconds after the window lapsed cannot resurrect an
 * auction the sweeper has already expired.
 */
const completeSale = async (payment) => {
  if (!payment.auctionId) return null;

  const now = new Date();

  const sold = await Auction.findOneAndUpdate(
    { _id: payment.auctionId, status: AUCTION_STATUS.PAYMENT_PENDING },
    { status: AUCTION_STATUS.SOLD, soldAt: now, paymentId: payment._id },
    { new: true }
  );

  if (!sold) {
    // Either already sold (a duplicate webhook) or expired before the money
    // arrived. Both need a human: the buyer has paid for something the system
    // no longer considers for sale.
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

  // The order carries the delivery address and drives fulfilment from here on.
  // Non-fatal: the auction is already SOLD and the money already taken, so a
  // failure here must not undo the sale — it leaves an order to reconcile,
  // which the admin orders screen surfaces.
  try {
    await orderService.markPaid(sold._id, payment._id);
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
