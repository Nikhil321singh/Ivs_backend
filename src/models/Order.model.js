const mongoose = require('mongoose');
const { ORDER_SOURCE, FULFILMENT_STATUS } = require('../constants/auctionEnums');

const { Schema } = mongoose;

/**
 * A device sale: who bought what, where it is going, and how far along it is.
 *
 * Its own collection rather than more fields on Auction, for three reasons. An
 * auction win and a Buy Now produce exactly the same thing, so they should
 * produce the same record. An order has its own lifecycle (address → payment →
 * dispatch → delivery) that keeps moving long after the auction is over. And it
 * belongs to the BUYER, while the auction belongs to the seller — "my orders"
 * and "my listings" are different questions with different owners.
 *
 * The shipping address is captured here per order, not read from the user's
 * profile: `User.address` is a single free-text KYC string with no pincode, and
 * a KYC address is where someone lives, not necessarily where they want a phone
 * delivered.
 */

const addressSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: null, trim: true },
    landmark: { type: String, default: null, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const noteSchema = new Schema(
  {
    text: { type: String, required: true, trim: true },
    adminId: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const orderSchema = new Schema(
  {
    auctionId: {
      type: Schema.Types.ObjectId,
      ref: 'Auction',
      required: true,
    },
    buyerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Who Grest owes for this device. The Grest system account on a platform
    // listing; a real user on a vendor one.
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    sellerType: { type: String, required: true },
    source: {
      type: String,
      enum: Object.values(ORDER_SOURCE),
      required: true,
    },
    // What the buyer owes, in paise. Copied at order time from the winning bid
    // (or the Buy Now price) so a later cascade or relist cannot change the
    // price of an order already placed.
    amountPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    // The winning bid, when this came from bidding. Null for a Buy Now.
    bidId: {
      type: Schema.Types.ObjectId,
      ref: 'Bid',
      default: null,
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
    paidAt: { type: Date, default: null },
    // Collected BEFORE payment — there is no sense taking money for something
    // we cannot deliver. Null only on an order still being composed.
    shippingAddress: { type: addressSchema, default: null },

    fulfilmentStatus: {
      type: String,
      enum: Object.values(FULFILMENT_STATUS),
      default: FULFILMENT_STATUS.PENDING,
    },
    dispatchedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    // Free-text operator trail: courier used, why it was delayed, who called
    // the buyer. Append-only in practice — the service pushes, never rewrites.
    notes: { type: [noteSchema], default: [] },
  },
  { timestamps: true }
);

// "My orders", newest first.
orderSchema.index({ buyerId: 1, createdAt: -1 });
// The admin fulfilment queue.
orderSchema.index({ fulfilmentStatus: 1, createdAt: -1 });
// What Grest owes a given vendor.
orderSchema.index({ sellerId: 1, createdAt: -1 });
// One live order per auction. Sparse-free: every order has an auctionId, and a
// relisted device gets a NEW auction, so this stays unique in practice while
// still allowing a cancelled order to be superseded.
orderSchema.index({ auctionId: 1, createdAt: -1 });

orderSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Order', orderSchema);
