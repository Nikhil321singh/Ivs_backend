const Auction = require('../../models/Auction.model');
const Bid = require('../../models/Bid.model');
const auctionService = require('../../services/auction.service');
const bidService = require('../../services/bid.service');
const notificationService = require('../../services/notification.service');
const { NOTIFICATION_TYPE } = require('../../constants/notification');
const { AUCTION_STATUS, CLOSED_STATUSES } = require('../../constants/auctionEnums');
const ApiError = require('../../utils/apiError');
const httpStatus = require('../../constants/httpStatus');
const MESSAGES = require('../../constants/messages');

/* eslint-disable no-console */

/**
 * Auction moderation for the portal.
 *
 * Deliberately NOT a second way to run auctions: an admin cannot bid, change a
 * price, or pick a winner. The only write here is taking a listing down, which
 * is the one thing a marketplace operator genuinely has to be able to do —
 * a stolen handset, a fraudulent listing, an abusive description.
 *
 * Everything else is read-only visibility.
 */

const paginate = ({ page = 1, limit = 20 }) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  return { safePage, safeLimit, skip: (safePage - 1) * safeLimit };
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every auction, filterable. Includes drafts, which customers never see. */
const listAuctions = async ({ page, limit, status = null, sellerId = null, search = null } = {}) => {
  const { safePage, safeLimit, skip } = paginate({ page, limit });

  const query = {};
  if (status) query.status = { $in: String(status).split(',').map((s) => s.trim()) };
  if (sellerId) query.sellerId = sellerId;
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    query.$or = [{ 'device.brand': rx }, { 'device.model': rx }, { 'device.imei': rx }];
  }

  const [items, total] = await Promise.all([
    Auction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('sellerId', 'name mobile userType')
      .populate('winnerId', 'name mobile')
      .lean(),
    Auction.countDocuments(query),
  ]);

  return {
    items,
    serverTime: new Date(),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

/** One auction with everything an operator needs to judge it. */
const getAuction = async (auctionId) => {
  const auction = await Auction.findById(auctionId)
    .populate('sellerId', 'name mobile userType kycCompleted')
    .populate('winnerId', 'name mobile')
    .lean();

  if (!auction) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);

  const recentBids = await Bid.find({ auctionId })
    .sort({ createdAt: -1 })
    .limit(20)
    .populate('bidderId', 'name mobile')
    .lean();

  return { auction, recentBids, serverTime: new Date() };
};

/** An auction's full bid history, with bidders identified. */
const getBids = async (auctionId, { page, limit } = {}) => {
  const { safePage, safeLimit, skip } = paginate({ page, limit });

  const [items, total] = await Promise.all([
    Bid.find({ auctionId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('bidderId', 'name mobile')
      .lean(),
    Bid.countDocuments({ auctionId }),
  ]);

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

/**
 * Takes a listing down.
 *
 * Unlike the seller's own cancel, this works even when the auction has bids —
 * that is the whole point: a stolen handset must come down mid-auction, not
 * after it sells. Everyone who bid is told, because they are entitled to know
 * an auction they were committed to has been pulled.
 *
 * `reason` is required by the validator: taking someone's listing down without
 * a recorded reason is not something an operator should be able to do quietly.
 */
const takeDown = async (auctionId, { reason }, adminId) => {
  const auction = await Auction.findById(auctionId);
  if (!auction) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);

  if (CLOSED_STATUSES.includes(auction.status) && auction.status !== AUCTION_STATUS.PAYMENT_PENDING) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.ALREADY_CLOSED);
  }

  const claimed = await Auction.findOneAndUpdate(
    { _id: auctionId, status: auction.status },
    {
      status: AUCTION_STATUS.CANCELLED,
      cancelledReason: reason,
      closedAt: new Date(),
    },
    { new: true }
  );

  if (!claimed) throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.ALREADY_CLOSED);

  const label = `${claimed.device?.brand || ''} ${claimed.device?.model || ''}`.trim() || 'a device';
  const bidders = await Bid.distinct('bidderId', { auctionId });

  const tell = async (userId, title, body) => {
    try {
      await notificationService.notifyUser(userId, {
        title,
        body,
        type: NOTIFICATION_TYPE.AUCTION,
        data: { auctionId: String(claimed._id), outcome: AUCTION_STATUS.CANCELLED },
      });
    } catch (err) {
      console.error('[Auction] takedown notification failed', String(userId), err.message);
    }
  };

  await tell(
    claimed.sellerId,
    'Your listing was removed',
    `${label} was taken down by our team. Reason: ${reason}`
  );

  await Promise.all(
    bidders.map((id) =>
      tell(id, 'An auction you bid on was removed', `${label} was taken down and will not be sold.`)
    )
  );

  console.log('[Auction] taken down', String(claimed._id), 'by admin', String(adminId), '-', reason);

  return auctionService.decorate(claimed, {});
};

/** Dashboard counters for the auctions tab. */
const getStats = async () => {
  const now = new Date();

  const [byStatus, liveEndingSoon, bidsToday, grossSoldPaise] = await Promise.all([
    Auction.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Auction.countDocuments({
      status: AUCTION_STATUS.LIVE,
      endAt: { $gt: now, $lte: new Date(now.getTime() + 60 * 60 * 1000) },
    }),
    Bid.countDocuments({ createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }),
    Auction.aggregate([
      { $match: { status: AUCTION_STATUS.SOLD } },
      { $group: { _id: null, total: { $sum: '$currentBidPaise' } } },
    ]),
  ]);

  return {
    byStatus: Object.fromEntries(byStatus.map((row) => [row._id, row.count])),
    liveEndingWithinHour: liveEndingSoon,
    bidsLast24h: bidsToday,
    grossSoldPaise: grossSoldPaise[0]?.total || 0,
    grossSoldInr: (grossSoldPaise[0]?.total || 0) / 100,
  };
};

module.exports = {
  listAuctions,
  getAuction,
  getBids,
  takeDown,
  getStats,
  // Re-exported so the controller can shape a bid list the same way the
  // customer-facing history does when it needs to.
  minNextBidPaise: bidService.minNextBidPaise,
};
