const mongoose = require('mongoose');
const { BID_STATUS } = require('../constants/auctionEnums');

const { Schema } = mongoose;

/**
 * Append-only bid history — one immutable row per bid ever placed, which is
 * what the brief means by "keep complete bid history for every auction".
 *
 * `status` is the one mutable field, and it only ever moves in one direction:
 * HIGHEST → OUTBID (a later bid beat it) or HIGHEST → WON / OUTBID → LOST (the
 * auction closed). The amount, the bidder and the time are never rewritten.
 *
 * `idempotencyKey` is what makes a double-tapped button or a retried request
 * harmless. The service derives it as `auctionId:bidderId:amountPaise`, which
 * is safe precisely because of the increment rule: a valid bid must always beat
 * the current one, so the same bidder can never legitimately bid the same
 * amount on the same auction twice. A repeat is therefore always a duplicate,
 * and the unique index turns it into a no-op rather than a second bid.
 */
const bidSchema = new Schema(
  {
    auctionId: {
      type: Schema.Types.ObjectId,
      ref: 'Auction',
      required: true,
    },
    bidderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Paise, matching Auction.startPricePaise and Payment.amountPaise.
    amountPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(BID_STATUS),
      default: BID_STATUS.HIGHEST,
      required: true,
    },
    idempotencyKey: {
      type: String,
    },
    // Kept for abuse investigation: a run of bids from one address across many
    // accounts is what shill bidding looks like.
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

// The auction's own bid history, newest first.
bidSchema.index({ auctionId: 1, createdAt: -1 });
// Resolving the top of the book, and reconciling it against the cached value
// on the Auction document.
bidSchema.index({ auctionId: 1, amountPaise: -1 });
// "My bids", filtered by status (ongoing / won / lost).
bidSchema.index({ bidderId: 1, status: 1, createdAt: -1 });
// Closing an auction flips every non-winning bid in one update.
bidSchema.index({ auctionId: 1, status: 1 });
// The duplicate-bid guard. Sparse so rows without a key are excluded.
bidSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

bidSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Bid', bidSchema);
