const mongoose = require('mongoose');
const Order = require('../models/Order.model');
const Auction = require('../models/Auction.model');
const notificationService = require('./notification.service');
const { NOTIFICATION_TYPE } = require('../constants/notification');
const { FULFILMENT_STATUS } = require('../constants/auctionEnums');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/* eslint-disable no-console */

/**
 * Orders: the record of who bought what and where it has to go.
 *
 * One order per sale, created BEFORE payment — there is no sense taking money
 * for something we cannot deliver, and an order with no address is a support
 * ticket waiting to happen. An auction win and a Buy Now create the same shape;
 * only `source` and the price differ.
 */

const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN')}`;

/**
 * Creates the order for a sale, or returns the one already open.
 *
 * Idempotent per (auction, buyer): tapping Pay twice must not produce two
 * orders, and the address on the second tap updates the first rather than
 * forking it — a buyer correcting their pincode expects exactly that.
 */
const createForAuction = async (
  auction,
  buyerId,
  { source, amountPaise, bidId = null, shippingAddress }
) => {
  const existing = await Order.findOne({
    auctionId: auction._id,
    buyerId,
    fulfilmentStatus: { $ne: FULFILMENT_STATUS.CANCELLED },
  });

  if (existing) {
    if (shippingAddress) {
      // Only while unpaid. Once money has moved the address is what the
      // dispatch team is working from, and changing it silently would send a
      // device somewhere nobody expects.
      if (existing.paidAt) {
        throw new ApiError(httpStatus.CONFLICT, MESSAGES.ORDER.ADDRESS_LOCKED);
      }
      existing.shippingAddress = shippingAddress;
      await existing.save();
    }
    return existing;
  }

  return Order.create({
    auctionId: auction._id,
    buyerId,
    sellerId: auction.sellerId,
    sellerType: auction.sellerType,
    source,
    amountPaise,
    bidId,
    shippingAddress,
  });
};

/** Marks the order paid once Razorpay confirms. Called from the sale path. */
const markPaid = async (auctionId, paymentId) => {
  const order = await Order.findOneAndUpdate(
    { auctionId, paidAt: null, fulfilmentStatus: { $ne: FULFILMENT_STATUS.CANCELLED } },
    { paidAt: new Date(), paymentId },
    { new: true }
  );

  return order;
};

/**
 * `.lean()` skips the schema's toJSON transform, so a lean row carries `_id`
 * where every other endpoint in this API returns `id`. Reshaping here keeps the
 * contract consistent rather than making one screen special.
 */
const withId = (row) => (row ? { ...row, id: String(row._id) } : row);

const getForBuyer = async (buyerId, { page = 1, limit = 20, status = null } = {}) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const query = { buyerId };
  if (status) query.fulfilmentStatus = status;

  const [items, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('auctionId', 'device photos status')
      .lean(),
    Order.countDocuments(query),
  ]);

  return {
    items: items.map(withId),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

const getByIdForBuyer = async (buyerId, orderId) => {
  // A malformed id is "no such order", not a server-side cast error. Without
  // this, /orders/garbage surfaces a Mongoose CastError as a confusing 400.
  if (!mongoose.isValidObjectId(orderId)) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.ORDER.NOT_FOUND);
  }

  const order = await Order.findOne({ _id: orderId, buyerId })
    .populate('auctionId', 'device photos status diagnosisReport')
    .lean();

  if (!order) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.ORDER.NOT_FOUND);

  return withId(order);
};

/* ------------------------------------------------------------------ *
 * Admin
 * ------------------------------------------------------------------ */

const list = async ({ page = 1, limit = 20, status = null, search = null } = {}) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const query = {};
  if (status) query.fulfilmentStatus = status;
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { 'shippingAddress.name': rx },
      { 'shippingAddress.phone': rx },
      { 'shippingAddress.pincode': rx },
    ];
  }

  const [items, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('buyerId', 'name mobile')
      .populate('sellerId', 'name mobile')
      .populate('auctionId', 'device photos status')
      .lean(),
    Order.countDocuments(query),
  ]);

  return {
    items: items.map(withId),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

const VALID_TRANSITIONS = Object.freeze({
  [FULFILMENT_STATUS.PENDING]: [FULFILMENT_STATUS.DISPATCHED, FULFILMENT_STATUS.CANCELLED],
  [FULFILMENT_STATUS.DISPATCHED]: [FULFILMENT_STATUS.DELIVERED, FULFILMENT_STATUS.CANCELLED],
  [FULFILMENT_STATUS.DELIVERED]: [],
  [FULFILMENT_STATUS.CANCELLED]: [],
});

/**
 * Moves an order along and tells the buyer.
 *
 * Transitions are checked rather than free-form: DELIVERED is terminal, and an
 * order cannot jump from PENDING straight to DELIVERED without someone having
 * marked it dispatched — which is exactly the gap a buyer asking "where is my
 * phone" falls into.
 */
const updateFulfilment = async (orderId, { status, note }, adminId) => {
  const order = await Order.findById(orderId).populate('auctionId', 'device');
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.ORDER.NOT_FOUND);

  if (status && status !== order.fulfilmentStatus) {
    const allowed = VALID_TRANSITIONS[order.fulfilmentStatus] || [];
    if (!allowed.includes(status)) {
      throw new ApiError(httpStatus.CONFLICT, MESSAGES.ORDER.INVALID_TRANSITION, [
        {
          field: 'status',
          message: `An order that is ${order.fulfilmentStatus} cannot become ${status}.`,
          from: order.fulfilmentStatus,
          allowed,
        },
      ]);
    }

    order.fulfilmentStatus = status;
    if (status === FULFILMENT_STATUS.DISPATCHED) order.dispatchedAt = new Date();
    if (status === FULFILMENT_STATUS.DELIVERED) order.deliveredAt = new Date();
  }

  if (note) order.notes.push({ text: note, adminId });

  await order.save();

  if (status) {
    const label =
      `${order.auctionId?.device?.brand || ''} ${order.auctionId?.device?.model || ''}`.trim() ||
      'your device';

    const copy = {
      [FULFILMENT_STATUS.DISPATCHED]: ['On its way', `${label} has been dispatched.`],
      [FULFILMENT_STATUS.DELIVERED]: ['Delivered', `${label} has been delivered. Enjoy it.`],
      [FULFILMENT_STATUS.CANCELLED]: [
        'Order cancelled',
        `Your order for ${label} was cancelled. Our team will be in touch.`,
      ],
    }[status];

    if (copy) {
      try {
        await notificationService.notifyUser(order.buyerId, {
          title: copy[0],
          body: copy[1],
          type: NOTIFICATION_TYPE.AUCTION,
          data: { orderId: String(order._id), fulfilmentStatus: status },
        });
      } catch (err) {
        console.error('[Order] notification failed', String(order._id), err.message);
      }
    }
  }

  return order;
};

/** What Grest owes each vendor — the settlement view, since there is no payout. */
const vendorSettlement = async () => {
  const rows = await Order.aggregate([
    { $match: { paidAt: { $ne: null }, sellerType: 'VENDOR' } },
    {
      $group: {
        _id: '$sellerId',
        orders: { $sum: 1 },
        grossPaise: { $sum: '$amountPaise' },
      },
    },
    { $sort: { grossPaise: -1 } },
  ]);

  await Auction.populate(rows, { path: '_id', select: 'name', model: 'User' });

  return rows.map((row) => ({
    seller: row._id,
    orders: row.orders,
    grossPaise: row.grossPaise,
    grossInr: row.grossPaise / 100,
  }));
};

module.exports = {
  createForAuction,
  markPaid,
  getForBuyer,
  getByIdForBuyer,
  list,
  updateFulfilment,
  vendorSettlement,
  rupees,
};
