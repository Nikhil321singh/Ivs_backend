const mongoose = require('mongoose');
const Auction = require('../models/Auction.model');
const Bid = require('../models/Bid.model');
const auctionCloser = require('./auctionCloser.service');
const notificationService = require('./notification.service');
const settingsService = require('./settings.service');
const { SETTING_KEYS } = require('../constants/settings');
const { NOTIFICATION_TYPE } = require('../constants/notification');
const { AUCTION_STATUS, BID_STATUS, ONGOING_BID_STATUSES } = require('../constants/auctionEnums');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/* eslint-disable no-console */

/**
 * Placing and reading bids.
 *
 * ── How simultaneous bids are made safe ──────────────────────────────────
 *
 * Every rule that decides whether a bid wins — the auction is live, it has not
 * expired, the amount clears the current bid plus the increment — is evaluated
 * INSIDE one `findOneAndUpdate` against the auction document, using `$expr` so
 * the comparison reads the document's own live values at write time.
 *
 * There is therefore no read-then-write gap to race through. MongoDB applies a
 * single-document update atomically, so of two bids arriving in the same
 * millisecond exactly one matches the filter and becomes the highest; the other
 * matches nothing and is told the minimum has moved. It is impossible for both
 * to win, and impossible for a bid to be accepted against a stale price.
 *
 * This is the same technique the token wallet uses for `debit` — a conditional
 * update IS a lock, held for the duration of one document write, and it needs
 * no transaction and no replica set. (Atlas would allow a real
 * `session.withTransaction`; it would add nothing to this guarantee, and the
 * test suite's single-node in-memory Mongo cannot run transactions at all.)
 *
 * The same statement also applies anti-sniping, because extending the end time
 * has to happen in the instant the late bid is accepted — doing it in a second
 * write would leave a window where the auction could be closed by the sweeper
 * between the bid landing and the extension applying.
 */

const minNextBidPaise = (auction) =>
  (auction.currentBidPaise === null || auction.currentBidPaise === undefined
    ? auction.startPricePaise
    : auction.currentBidPaise + auction.bidIncrementPaise);

/**
 * A double-tapped button and a retried request must not become two bids.
 *
 * When the client does not supply a key we derive one from the bid itself.
 * That is safe because of the increment rule: a valid bid always has to beat
 * the current one, so the same bidder can never legitimately bid the same
 * amount on the same auction twice. A repeat is always a duplicate.
 */
const resolveIdempotencyKey = (auctionId, userId, amountPaise, supplied) =>
  (supplied ? `client:${supplied}` : `${auctionId}:${userId}:${amountPaise}`);

const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN')}`;

const placeBid = async (userId, auctionId, { amountPaise, idempotencyKey = null, ip = null }) => {
  if (!mongoose.isValidObjectId(auctionId)) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);
  }

  const key = resolveIdempotencyKey(auctionId, userId, amountPaise, idempotencyKey);

  // Checked before anything else so a retry returns the original bid rather
  // than tripping one of the guards below ("you are already the highest").
  const existing = await Bid.findOne({ idempotencyKey: key });
  if (existing) {
    const auction = await Auction.findById(auctionId);
    return { bid: existing, auction, duplicate: true };
  }

  let auction = await Auction.findById(auctionId);
  if (!auction) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);

  // Lazy close: an auction past its end time is settled before we look at it,
  // so a bid can never land on one the sweeper has not reached yet.
  auction = await auctionCloser.ensureClosed(auction);

  if (String(auction.sellerId) === String(userId)) {
    throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.BID.OWN_AUCTION);
  }
  if (auction.status !== AUCTION_STATUS.LIVE) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.NOT_LIVE);
  }
  if (String(auction.currentBidderId) === String(userId)) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.BID.ALREADY_HIGHEST);
  }

  const settings = await settingsService.getAll();
  const antiSnipeEnabled = settings[SETTING_KEYS.AUCTION_ANTI_SNIPE_ENABLED] === true;
  const windowMs = settings[SETTING_KEYS.AUCTION_ANTI_SNIPE_WINDOW_SECONDS] * 1000;
  const extendMs = settings[SETTING_KEYS.AUCTION_ANTI_SNIPE_EXTEND_SECONDS] * 1000;

  const now = new Date();

  // True when this bid lands inside the closing window and the auction should
  // therefore be pushed out. Evaluated by the database against the document's
  // own endAt, not against the copy we read a moment ago.
  const isLateBid = {
    $and: [antiSnipeEnabled, { $lte: [{ $subtract: ['$endAt', now] }, windowMs] }],
  };

  const before = await Auction.findOneAndUpdate(
    {
      _id: auction._id,
      status: AUCTION_STATUS.LIVE,
      startAt: { $lte: now },
      endAt: { $gt: now },
      // Re-checked atomically: between the guard above and this write, another
      // request of ours could have made this user the highest bidder.
      currentBidderId: { $ne: new mongoose.Types.ObjectId(String(userId)) },
      // The money rule. First bid must clear the start price; every later bid
      // must clear the current bid plus the increment.
      $expr: {
        $gte: [
          amountPaise,
          {
            $cond: [
              { $eq: [{ $ifNull: ['$currentBidPaise', null] }, null] },
              '$startPricePaise',
              { $add: ['$currentBidPaise', '$bidIncrementPaise'] },
            ],
          },
        ],
      },
    },
    [
      {
        $set: {
          currentBidPaise: amountPaise,
          currentBidderId: new mongoose.Types.ObjectId(String(userId)),
          bidCount: { $add: ['$bidCount', 1] },
          endAt: {
            $cond: [isLateBid, new Date(now.getTime() + extendMs), '$endAt'],
          },
          extensionCount: {
            $cond: [isLateBid, { $add: ['$extensionCount', 1] }, '$extensionCount'],
          },
        },
      },
    ],
    // The PRE-update document: it tells us whose bid was just beaten.
    { new: false }
  );

  if (!before) {
    // We lost the race, or the bid was never good enough. Re-read to say which.
    const fresh = await auctionCloser.ensureClosed(await Auction.findById(auction._id));

    if (!fresh) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);
    if (fresh.status !== AUCTION_STATUS.LIVE) {
      throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.ALREADY_CLOSED);
    }
    if (String(fresh.currentBidderId) === String(userId)) {
      throw new ApiError(httpStatus.CONFLICT, MESSAGES.BID.ALREADY_HIGHEST);
    }

    const required = minNextBidPaise(fresh);

    throw new ApiError(httpStatus.CONFLICT, MESSAGES.BID.TOO_LOW, [
      {
        field: 'amountPaise',
        message: `The minimum next bid is ${rupees(required)}.`,
        yourBidPaise: amountPaise,
        currentBidPaise: fresh.currentBidPaise,
        minNextBidPaise: required,
        bidCount: fresh.bidCount,
      },
    ]);
  }

  // We hold the top of the book. Record the bid itself.
  let bid;
  try {
    bid = await Bid.create({
      auctionId: auction._id,
      bidderId: userId,
      amountPaise,
      status: BID_STATUS.HIGHEST,
      idempotencyKey: key,
      ip,
    });
  } catch (err) {
    // The claim succeeded but the history row did not. Put the auction back as
    // it was, or the cached top of the book would point at a bid that does not
    // exist — the same compensation the wallet does when a ledger write fails.
    await Auction.updateOne(
      { _id: auction._id, currentBidderId: userId, currentBidPaise: amountPaise },
      {
        $set: {
          currentBidPaise: before.currentBidPaise,
          currentBidderId: before.currentBidderId,
          currentBidId: before.currentBidId,
        },
        $inc: { bidCount: -1 },
      }
    );

    if (err.code === 11000) {
      const raced = await Bid.findOne({ idempotencyKey: key });
      if (raced) return { bid: raced, auction: before, duplicate: true };
    }
    throw err;
  }

  const [updated] = await Promise.all([
    Auction.findByIdAndUpdate(auction._id, { currentBidId: bid._id }, { new: true }),
    // The bid this one beat is no longer winning. Scoped by _id so a bid that
    // arrived in between is not wrongly demoted.
    before.currentBidId
      ? Bid.updateOne(
          { _id: before.currentBidId, status: BID_STATUS.HIGHEST },
          { status: BID_STATUS.OUTBID }
        )
      : Promise.resolve(),
  ]);

  if (before.currentBidderId && String(before.currentBidderId) !== String(userId)) {
    const label = `${updated.device?.brand || ''} ${updated.device?.model || ''}`.trim();
    try {
      await notificationService.notifyUser(before.currentBidderId, {
        title: 'You have been outbid',
        body: `Someone bid ${rupees(amountPaise)} on ${label || 'an auction you are bidding on'}. Bid again to stay in it.`,
        type: NOTIFICATION_TYPE.AUCTION,
        data: {
          auctionId: String(updated._id),
          outcome: BID_STATUS.OUTBID,
          currentBidPaise: String(amountPaise),
          minNextBidPaise: String(minNextBidPaise(updated)),
        },
      });
    } catch (err) {
      console.error('[Auction] outbid notification failed', err.message);
    }
  }

  return { bid, auction: updated, duplicate: false, extended: +updated.endAt !== +before.endAt };
};

/** An auction's complete bid history, newest first. */
const getHistory = async (auctionId, { page = 1, limit = 20 } = {}) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const [items, total] = await Promise.all([
    Bid.find({ auctionId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('bidderId', 'name')
      .lean(),
    Bid.countDocuments({ auctionId }),
  ]);

  return {
    items: items.map((bid) => ({
      id: String(bid._id),
      amountPaise: bid.amountPaise,
      amountInr: bid.amountPaise / 100,
      status: bid.status,
      // Bidders are shown by first name only. A public bid history that named
      // everyone in full would be a directory of who owns what and who has
      // money to spend.
      bidder: (bid.bidderId?.name || 'Bidder').split(' ')[0],
      bidderId: String(bid.bidderId?._id || bid.bidderId),
      createdAt: bid.createdAt,
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

const STATUS_GROUPS = Object.freeze({
  ongoing: [...ONGOING_BID_STATUSES],
  won: [BID_STATUS.WON],
  lost: [BID_STATUS.LOST],
});

/**
 * "My bids", one row per auction rather than per bid — a bidder who raised
 * their own bid four times wants to see one auction, not four rows.
 *
 * The group keeps each auction's most recent bid, which is also the one whose
 * status is authoritative for that bidder.
 */
const getMyBids = async (userId, { group = null, page = 1, limit = 20 } = {}) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const statuses = STATUS_GROUPS[String(group || '').toLowerCase()] || null;

  const match = { bidderId: new mongoose.Types.ObjectId(String(userId)) };
  if (statuses) match.status = { $in: statuses };

  const base = [
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$auctionId', bid: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$bid' } },
  ];

  const [rows, counted] = await Promise.all([
    Bid.aggregate([
      ...base,
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: safeLimit },
      {
        $lookup: {
          from: 'auctions',
          localField: 'auctionId',
          foreignField: '_id',
          as: 'auction',
        },
      },
      { $unwind: '$auction' },
    ]),
    Bid.aggregate([...base, { $count: 'total' }]),
  ]);

  const total = counted[0]?.total || 0;
  const now = new Date();

  return {
    items: rows.map((row) => ({
      auctionId: String(row.auctionId),
      myBidPaise: row.amountPaise,
      myBidInr: row.amountPaise / 100,
      status: row.status,
      bidAt: row.createdAt,
      auction: {
        id: String(row.auction._id),
        status: row.auction.status,
        device: row.auction.device,
        condition: row.auction.condition,
        photo: row.auction.photos?.[0]?.url || null,
        currentBidPaise: row.auction.currentBidPaise,
        bidCount: row.auction.bidCount,
        endAt: row.auction.endAt,
        secondsRemaining: Math.max(0, Math.floor((row.auction.endAt - now) / 1000)),
        minNextBidPaise: minNextBidPaise(row.auction),
      },
    })),
    serverTime: now,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

module.exports = {
  placeBid,
  getHistory,
  getMyBids,
  minNextBidPaise,
};
