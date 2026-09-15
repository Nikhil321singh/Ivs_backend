const mongoose = require('mongoose');
const {
  AUCTION_STATUS,
  DEVICE_CONDITION,
  DIAGNOSTIC_STATUS,
} = require('../constants/auctionEnums');

const { Schema } = mongoose;

/**
 * One device listed for auction, from draft through to sold.
 *
 * Deliberately a single document rather than a Listing + an Auction: the seller
 * views the brief asks for (Draft / Live / Ended / Sold) are states of the same
 * thing, and splitting them would mean keeping two rows in step for no gain.
 *
 * THE BID LEDGER IS THE TRUTH. `currentBidPaise`, `currentBidderId`,
 * `currentBidId` and `bidCount` are a *cache* of the top of the book, kept here
 * so the live-auction list can render without a per-row aggregation over Bid.
 * They are only ever written by the atomic conditional update in
 * bid.service.js, which is what makes concurrent bids safe — see the long note
 * there.
 *
 * The diagnosis and the IMEI check are REFERENCED, never copied. A listing that
 * embedded a snapshot of the report could show something the diagnosis no
 * longer says, and would duplicate a system that already exists.
 */

const photoSchema = new Schema(
  {
    url: { type: String, required: true },
    // The storage key, kept so the object can actually be deleted when the
    // seller removes the photo — without it, removing a photo from the array
    // would orphan the file in S3 forever.
    publicId: { type: String, required: true },
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } }
);

const auctionSchema = new Schema(
  {
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(AUCTION_STATUS),
      default: AUCTION_STATUS.DRAFT,
      required: true,
    },

    /* ---- the device ---------------------------------------------------- */
    device: {
      // Free text, like DiagnoseRecord.deviceModel — there is no device
      // catalogue in this system, and a readable label beats a rejected
      // listing. Stored trimmed; the brand filter matches case-insensitively.
      brand: { type: String, required: true, trim: true },
      model: { type: String, required: true, trim: true },
      storageGb: { type: Number, default: null, min: 0 },
      ramGb: { type: Number, default: null, min: 0 },
      color: { type: String, default: null, trim: true },
      // The handset's own identifier, not a person's — so it is stored plainly,
      // the same rule DiagnoseRecord.imei follows.
      imei: { type: String, default: null, trim: true },
    },
    condition: {
      type: String,
      enum: Object.values(DEVICE_CONDITION),
      required: true,
    },
    conditionNotes: { type: String, default: null, trim: true },
    photos: { type: [photoSchema], default: [] },

    /* ---- provenance: references to the systems that already exist ------- */
    diagnoseSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'DiagnoseSession',
      default: null,
    },
    imeiVerificationId: {
      type: Schema.Types.ObjectId,
      ref: 'ImeiVerificationLog',
      default: null,
    },
    // Denormalised from the two references above, purely so the live-auction
    // filters can hit an index instead of joining every DiagnoseSession and
    // ImeiVerificationLog on every page of results. Set once at publish time,
    // when the references are resolved and validated.
    diagnosticStatus: {
      type: String,
      enum: Object.values(DIAGNOSTIC_STATUS),
      default: DIAGNOSTIC_STATUS.UNVERIFIED,
    },
    // CLEAN / BLOCKED / STOLEN / UNKNOWN, mirroring cdotIvsProvider.IVS_STATUS.
    // Not an enum here: the vocabulary belongs to the provider, and pinning a
    // copy of it in this schema would mean a new CEIR state breaks writes.
    imeiStatus: { type: String, default: null },

    /* ---- auction terms, in paise (matching Payment.amountPaise) --------- */
    startPricePaise: { type: Number, required: true, min: 0 },
    bidIncrementPaise: { type: Number, required: true, min: 1 },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    // What endAt was when the auction was published. Anti-sniping moves endAt;
    // keeping the original makes "why did this run 6 minutes long" answerable.
    originalEndAt: { type: Date, default: null },
    extensionCount: { type: Number, default: 0 },

    /* ---- cached top of the book (Bid is the truth) --------------------- */
    currentBidPaise: { type: Number, default: null },
    currentBidderId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    currentBidId: { type: Schema.Types.ObjectId, ref: 'Bid', default: null },
    bidCount: { type: Number, default: 0 },

    /* ---- outcome ------------------------------------------------------- */
    winnerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    winningBidId: { type: Schema.Types.ObjectId, ref: 'Bid', default: null },
    closedAt: { type: Date, default: null },
    // Set when the auction closes with a winner. After this the sale lapses.
    paymentDueAt: { type: Date, default: null },
    // The winner's Razorpay payment for the device (purpose AUCTION).
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    soldAt: { type: Date, default: null },

    // What the seller was charged to publish, and the ledger row proving it.
    // Stored because the price is operator-editable: without it, a listing
    // history would re-price old listings at today's rate.
    listingCost: { type: Number, default: null },
    listingChargeSource: { type: String, default: null },
    cancelledReason: { type: String, default: null },
  },
  { timestamps: true }
);

// The live-auction browse: every query filters on status and orders by or
// bounds endAt, so this is the index that has to exist.
auctionSchema.index({ status: 1, endAt: 1 });
// The sweeper's query — find LIVE auctions past their end time.
auctionSchema.index({ status: 1, endAt: 1, startAt: 1 });
// "My listings", filtered by status.
auctionSchema.index({ sellerId: 1, status: 1, createdAt: -1 });
// Brand is the headline filter; paired with status so it stays selective.
auctionSchema.index({ status: 1, 'device.brand': 1 });
// The payment-expiry sweep.
auctionSchema.index({ status: 1, paymentDueAt: 1 });

auctionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Auction', auctionSchema);
