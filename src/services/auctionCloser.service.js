const Auction = require('../models/Auction.model');
const Bid = require('../models/Bid.model');
const notificationService = require('./notification.service');
const settingsService = require('./settings.service');
const { SETTING_KEYS } = require('../constants/settings');
const { NOTIFICATION_TYPE } = require('../constants/notification');
const { AUCTION_STATUS, BID_STATUS } = require('../constants/auctionEnums');

/* eslint-disable no-console */

/**
 * Closing auctions, and the two sweeps that keep the board tidy.
 *
 * Every transition here is an ATOMIC CONDITIONAL UPDATE: the status the auction
 * must currently be in is part of the filter, so the update either wins or
 * matches nothing. That is what makes closing idempotent and safe to call from
 * anywhere — two sweepers, a sweeper racing a reader, a retried request — with
 * exactly one of them doing the work and the rest becoming no-ops.
 *
 * There are deliberately TWO ways an auction closes:
 *
 *   1. LAZILY — any read or bid touching an auction past its end time closes it
 *      first. This is the correctness guarantee: even with the sweeper dead, an
 *      expired auction can never accept a bid or render as live.
 *
 *   2. BY SWEEP — a periodic pass closes auctions nobody happens to be looking
 *      at, so winners are notified promptly rather than whenever someone next
 *      opens the page. This is a liveness improvement, not a correctness one.
 *
 * `new Date()` here is the server's clock, compared inside the database query.
 * No client-supplied time is read anywhere in this file, or anywhere that
 * decides whether an auction is still running.
 */

const BATCH_LIMIT = 50;

const notifySafely = async (userId, payload) => {
  try {
    await notificationService.notifyUser(userId, { ...payload, type: NOTIFICATION_TYPE.AUCTION });
  } catch (err) {
    // A push failure must never abandon a close half-done: the auction is
    // already closed and the money question already settled.
    console.error('[Auction] notification failed', String(userId), err.message);
  }
};

const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN')}`;

const deviceLabel = (auction) => `${auction.device?.brand || ''} ${auction.device?.model || ''}`.trim();

/**
 * Settles every bid on a closed auction and tells everyone what happened.
 * Runs only for the caller that actually won the status transition, so a
 * replayed close never re-notifies.
 */
const settleBidsAndNotify = async (auction) => {
  const label = deviceLabel(auction) || 'your device';

  if (!auction.winningBidId) {
    await notifySafely(auction.sellerId, {
      title: 'Auction ended with no bids',
      body: `Nobody bid on ${label}. You can relist it whenever you like.`,
      data: { auctionId: String(auction._id), outcome: AUCTION_STATUS.ENDED_NO_BIDS },
    });
    return;
  }

  // Everyone who is not the winner has lost. Done as one update rather than a
  // row at a time so a busy auction closes in a single round trip.
  const losers = await Bid.distinct('bidderId', {
    auctionId: auction._id,
    _id: { $ne: auction.winningBidId },
  });

  await Promise.all([
    Bid.updateOne({ _id: auction.winningBidId }, { status: BID_STATUS.WON }),
    Bid.updateMany(
      { auctionId: auction._id, _id: { $ne: auction.winningBidId } },
      { status: BID_STATUS.LOST }
    ),
  ]);

  await notifySafely(auction.winnerId, {
    title: 'You won the auction',
    body: `You won ${label} at ${rupees(auction.currentBidPaise)}. Pay now to complete the purchase.`,
    data: {
      auctionId: String(auction._id),
      outcome: BID_STATUS.WON,
      amountPaise: String(auction.currentBidPaise),
      paymentDueAt: auction.paymentDueAt ? auction.paymentDueAt.toISOString() : null,
    },
  });

  await notifySafely(auction.sellerId, {
    title: 'Your listing sold at auction',
    body: `${label} closed at ${rupees(auction.currentBidPaise)}. We will let you know once the buyer pays.`,
    data: { auctionId: String(auction._id), outcome: AUCTION_STATUS.PAYMENT_PENDING },
  });

  // The losers are told separately and last: it is the least urgent message,
  // and a failure here must not delay the winner's.
  await Promise.all(
    losers
      .filter((id) => String(id) !== String(auction.winnerId))
      .map((id) =>
        notifySafely(id, {
          title: 'Auction ended',
          body: `${label} sold to another bidder. Better luck on the next one.`,
          data: { auctionId: String(auction._id), outcome: BID_STATUS.LOST },
        })
      )
  );
};

/**
 * Closes one auction if — and only if — it is LIVE and its end time has passed.
 * Safe to call on anything: an auction that is not due, or already closed, is
 * returned untouched.
 */
const closeAuction = async (auctionId) => {
  const now = new Date();

  const paymentWindowHours = await settingsService.get(SETTING_KEYS.AUCTION_PAYMENT_WINDOW_HOURS);

  // Read first only to decide WHICH terminal state applies. The authority is
  // the conditional update below, which re-checks status and endAt itself.
  const current = await Auction.findById(auctionId);
  if (!current) return null;
  if (current.status !== AUCTION_STATUS.LIVE) return current;
  if (current.endAt > now) return current;

  const hasWinner = !!current.currentBidId;

  const update = hasWinner
    ? {
        status: AUCTION_STATUS.PAYMENT_PENDING,
        winnerId: current.currentBidderId,
        winningBidId: current.currentBidId,
        // The price is pinned here rather than read from `currentBidPaise` at
        // payment time. They are equal now, but a second-chance offer moves the
        // winner down the book without moving the top of it — and billing a
        // lower bidder for the top bid would charge them somebody else's bid.
        salePricePaise: current.currentBidPaise,
        closedAt: now,
        paymentDueAt: new Date(now.getTime() + paymentWindowHours * 60 * 60 * 1000),
      }
    : { status: AUCTION_STATUS.ENDED_NO_BIDS, closedAt: now };

  const claimed = await Auction.findOneAndUpdate(
    // The gate. `endAt` is re-checked here because a bid may have extended the
    // auction (anti-sniping) between the read above and this write — closing it
    // then would end an auction that is legitimately still running.
    { _id: auctionId, status: AUCTION_STATUS.LIVE, endAt: { $lte: now } },
    update,
    { new: true }
  );

  if (!claimed) {
    // Someone else closed it, or it was extended out from under us. Either way
    // there is nothing for this caller to do.
    return Auction.findById(auctionId);
  }

  await settleBidsAndNotify(claimed);

  return claimed;
};

/**
 * Lazy close. Call before serving or bidding on an auction: if it is LIVE and
 * past its end time, it is closed first and the closed document returned.
 */
const ensureClosed = async (auction) => {
  if (!auction) return auction;
  if (auction.status !== AUCTION_STATUS.LIVE) return auction;
  if (auction.endAt > new Date()) return auction;

  return (await closeAuction(auction._id)) || auction;
};

/** Promotes SCHEDULED auctions whose start time has arrived. */
const activateDue = async () => {
  const now = new Date();

  const result = await Auction.updateMany(
    { status: AUCTION_STATUS.SCHEDULED, startAt: { $lte: now }, endAt: { $gt: now } },
    { status: AUCTION_STATUS.LIVE }
  );

  return result.modifiedCount || 0;
};

/** Closes LIVE auctions whose end time has passed. */
const closeExpired = async (limit = BATCH_LIMIT) => {
  const now = new Date();

  const due = await Auction.find({ status: AUCTION_STATUS.LIVE, endAt: { $lte: now } })
    .select('_id')
    .limit(limit)
    .lean();

  let closed = 0;
  for (const { _id } of due) {
    // Sequential: each close writes several documents and sends pushes, and a
    // parallel burst would spike both Mongo and FCM for no benefit.
    // eslint-disable-next-line no-await-in-loop
    const result = await closeAuction(_id);
    if (result && result.status !== AUCTION_STATUS.LIVE) closed += 1;
  }

  return closed;
};

/**
 * Finds the next bidder who should be offered a device the current holder did
 * not pay for.
 *
 * Works down the book by BIDDER, not by bid: someone who raised their own bid
 * four times is one candidate, considered at their best price. Anyone already
 * offered and passed over is skipped, so nobody gets two bites at the same
 * auction. The seller is excluded for the same reason they cannot bid.
 */
const nextOfferableBid = async (auction) => {
  const excluded = [...(auction.passedBidderIds || []), auction.sellerId].filter(Boolean);

  const [best] = await Bid.aggregate([
    { $match: { auctionId: auction._id, bidderId: { $nin: excluded } } },
    { $sort: { amountPaise: -1, createdAt: 1 } },
    { $group: { _id: '$bidderId', bid: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$bid' } },
    // Highest remaining bidder wins the offer; earliest bid breaks a tie, which
    // is the same rule that decided the original auction.
    { $sort: { amountPaise: -1, createdAt: 1 } },
    { $limit: 1 },
  ]);

  return best || null;
};

/**
 * Lapses the current holder's claim and passes the device down the book.
 *
 * THE PRICE MOVES WITH THE OFFER. The next bidder pays THEIR OWN bid, not the
 * one above them — they never agreed to that number, and charging it would be
 * billing them for somebody else's bid. That is why `salePricePaise` is a
 * stored field rather than read from the top of the book at payment time.
 *
 * When the bidders run out (or second chances are switched off) the auction
 * ends PAYMENT_EXPIRED and the seller is free to relist.
 */
const passOfferDown = async (auction, { now, windowHours, secondChance }) => {
  const label = deviceLabel(auction) || 'the device';
  const failedBidderId = auction.winnerId;

  // The claim that makes this idempotent: only the caller that flips the
  // current holder's window does any of the work below.
  const claimed = await Auction.findOneAndUpdate(
    {
      _id: auction._id,
      status: AUCTION_STATUS.PAYMENT_PENDING,
      paymentDueAt: { $lte: now },
      winnerId: auction.winnerId,
    },
    {
      $set: { winnerId: null, winningBidId: null, salePricePaise: null, paymentDueAt: null },
      $addToSet: { passedBidderIds: failedBidderId },
    },
    { new: true }
  );

  if (!claimed) return null;

  if (auction.winningBidId) {
    await Bid.updateOne({ _id: auction.winningBidId }, { status: BID_STATUS.EXPIRED });
  }

  await notifySafely(failedBidderId, {
    title: 'Payment window closed',
    body: `You did not pay for ${label} in time, so it has been offered to another bidder.`,
    data: { auctionId: String(claimed._id), outcome: BID_STATUS.EXPIRED },
  });

  const next = secondChance ? await nextOfferableBid(claimed) : null;

  if (!next) {
    const ended = await Auction.findOneAndUpdate(
      { _id: claimed._id, status: AUCTION_STATUS.PAYMENT_PENDING },
      { status: AUCTION_STATUS.PAYMENT_EXPIRED },
      { new: true }
    );

    await notifySafely(claimed.sellerId, {
      title: 'Device went unsold',
      body: `Nobody completed payment for ${label}. You can relist it now.`,
      data: { auctionId: String(claimed._id), outcome: AUCTION_STATUS.PAYMENT_EXPIRED },
    });

    return ended || claimed;
  }

  const offered = await Auction.findOneAndUpdate(
    { _id: claimed._id, status: AUCTION_STATUS.PAYMENT_PENDING, winnerId: null },
    {
      winnerId: next.bidderId,
      winningBidId: next._id,
      salePricePaise: next.amountPaise,
      paymentDueAt: new Date(now.getTime() + windowHours * 60 * 60 * 1000),
    },
    { new: true }
  );

  if (!offered) return claimed;

  await Bid.updateOne({ _id: next._id }, { status: BID_STATUS.WON });

  await notifySafely(next.bidderId, {
    title: 'The device is yours if you want it',
    body: `The winning bidder for ${label} did not pay, so it is offered to you at your bid of ${rupees(next.amountPaise)}. Pay within ${windowHours} hours to claim it.`,
    data: {
      auctionId: String(offered._id),
      outcome: BID_STATUS.WON,
      secondChance: 'true',
      amountPaise: String(next.amountPaise),
      paymentDueAt: offered.paymentDueAt.toISOString(),
    },
  });

  await notifySafely(offered.sellerId, {
    title: 'Buyer did not pay',
    body: `The winner of ${label} did not pay, so it has been offered to the next bidder at ${rupees(next.amountPaise)}.`,
    data: { auctionId: String(offered._id), outcome: AUCTION_STATUS.PAYMENT_PENDING },
  });

  return offered;
};

/**
 * Processes every payment window that has run out: each one either cascades to
 * the next bidder or ends the auction unsold.
 */
const expireUnpaid = async (limit = BATCH_LIMIT) => {
  const now = new Date();

  const [windowHours, secondChance] = await Promise.all([
    settingsService.get(SETTING_KEYS.AUCTION_PAYMENT_WINDOW_HOURS),
    settingsService.get(SETTING_KEYS.AUCTION_SECOND_CHANCE_ENABLED),
  ]);

  const due = await Auction.find({
    status: AUCTION_STATUS.PAYMENT_PENDING,
    paymentDueAt: { $lte: now },
  })
    .limit(limit)
    .lean();

  let expired = 0;

  for (const auction of due) {
    // Sequential for the same reason closeExpired is: each pass writes several
    // documents and sends pushes.
    // eslint-disable-next-line no-await-in-loop
    const result = await passOfferDown(auction, { now, windowHours, secondChance: secondChance === true });
    if (result) expired += 1;
  }

  return expired;
};

/** One full pass. Safe to run concurrently with itself and with live traffic. */
const sweep = async () => {
  const [activated, closed, expired] = [await activateDue(), await closeExpired(), await expireUnpaid()];

  if (activated || closed || expired) {
    console.log(
      `[Auction] sweep: ${activated} activated, ${closed} closed, ${expired} payment-expired`
    );
  }

  return { activated, closed, expired };
};

let timer = null;

/**
 * Starts the periodic sweep.
 *
 * PM2 runs this app with `instances: 1`, so a single in-process interval is
 * enough today — and because every transition above is an atomic conditional
 * update, it stays correct if that ever becomes cluster mode and several
 * processes sweep at once. `scripts/auction-sweep.js` runs the same pass from
 * cron for anyone who would rather schedule it outside the web process.
 */
const startSweeper = ({ intervalMs = 30000 } = {}) => {
  if (timer) return timer;

  timer = setInterval(() => {
    sweep().catch((err) => console.error('[Auction] sweep failed:', err.message));
  }, intervalMs);

  // Never hold the process open on this alone — a pending interval would stop
  // the server exiting cleanly on SIGTERM.
  if (timer.unref) timer.unref();

  return timer;
};

const stopSweeper = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = {
  closeAuction,
  ensureClosed,
  activateDue,
  closeExpired,
  expireUnpaid,
  sweep,
  startSweeper,
  stopSweeper,
};
