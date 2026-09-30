const mongoose = require('mongoose');
const {
  AUCTION_STATUS,
  DEVICE_CONDITION,
  DIAGNOSTIC_STATUS,
  SELLER_TYPE,
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
    /**
     * PLATFORM for Grest's own refurbished stock, listed from the admin portal;
     * VENDOR for a device a user listed through the app.
     *
     * `sellerId` is set either way — platform listings are owned by the Grest
     * system account — so every existing query, populate and index keeps
     * working unchanged. This field is what decides whether a listing credit is
     * charged and who Grest owes after the sale.
     */
    sellerType: {
      type: String,
      enum: Object.values(SELLER_TYPE),
      default: SELLER_TYPE.VENDOR,
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

    // Snapshot of the Grest diagnostic report as run through the external c2b
    // flow during the Sell wizard. Unlike the DiagnoseSession reference below,
    // that diagnosis lives in a separate vendor system with no row here to point
    // at — so the grade + per-test results are copied onto the listing so buyers
    // can see "Diagnosed by Grest" with the full report on the bid-detail screen.
    diagnosisReport: {
      type: new Schema(
        {
          grade: { type: String, default: null },
          estimatedValueInr: { type: Number, default: null },
          imei: { type: String, default: null },
          // Blancco's own report id and when the handset was actually tested,
          // so a listing can be traced back to the run that produced it.
          reportId: { type: String, default: null },
          diagnosedAt: { type: String, default: null },
          source: { type: String, default: null },
          /**
           * The two things that decide whether a handset is resaleable at all.
           * A device still tied to an iCloud account or an MDM enrolment is
           * useless to whoever buys it, so this is surfaced rather than buried
           * in the test list.
           */
          locks: {
            findMyIphone: { type: String, default: null },
            mdmStatus: { type: String, default: null },
            componentsAuthentic: { type: Boolean, default: null },
          },
          battery: {
            healthPercent: { type: Number, default: null },
            cycles: { type: Number, default: null },
            designCapacityMah: { type: Number, default: null },
            currentCapacityMah: { type: Number, default: null },
          },
          skipped: { type: Number, default: 0 },
          // Blancco device "properties" — modelName / storage / serial /
          // osVersion. Mixed so a new property key never breaks the write.
          properties: { type: Schema.Types.Mixed, default: null },
          passed: { type: Number, default: 0 },
          failed: { type: Number, default: 0 },
          total: { type: Number, default: 0 },
          tests: {
            type: [new Schema({ name: String, result: String }, { _id: false })],
            default: [],
          },
        },
        { _id: false }
      ),
      default: null,
    },

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
    /**
     * Instant purchase price. Null means the device can only be won by bidding.
     *
     * Clicking Buy Now ends the auction there and then — the buyer does not
     * wait for it to close — and they pay inside their own window, like any
     * winner. Offered only while the current bid is still below it: once
     * bidding passes this number, selling at it would be selling below the book.
     */
    buyNowPricePaise: { type: Number, default: null, min: 0 },
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
    // Whoever currently holds the right to buy: the top bidder, the next bidder
    // down after a second-chance offer, or the person who hit Buy Now.
    winnerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // The bid being honoured. THE SALE PRICE IS THIS BID'S AMOUNT, not
    // `currentBidPaise` — after a second-chance offer those differ, and
    // charging the top bid to a lower bidder would be charging them for
    // somebody else's bid.
    winningBidId: { type: Schema.Types.ObjectId, ref: 'Bid', default: null },
    // What the current holder owes. Set from the winning bid, or from
    // buyNowPricePaise on an instant purchase.
    salePricePaise: { type: Number, default: null },
    /**
     * Bidders who were offered the device and did not pay. They are skipped
     * when the offer cascades further down, so a bidder never gets a second
     * bite at the same auction.
     */
    passedBidderIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    closedAt: { type: Date, default: null },
    // When the current holder's window runs out. On expiry the offer passes to
    // the next bidder down rather than ending the auction — see
    // auctionCloser.service.js.
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
