/**
 * Auction and bidding vocabulary. One place for every enum the auction stack
 * stores or returns, so the model, the service and the client never match on
 * free strings that drift — the same role walletEnums.js plays for the ledger.
 */

/**
 * A listing's lifecycle.
 *
 *   DRAFT           being composed by the seller; invisible to everyone else
 *   SCHEDULED       published, but startAt is still in the future
 *   LIVE            accepting bids
 *   ENDED_NO_BIDS   closed with nobody having bid
 *   PAYMENT_PENDING closed with a winner, waiting for them to pay. Also the
 *                   state a Buy Now sits in between the click and the payment
 *   SOLD            the buyer paid; the deal is done
 *   PAYMENT_EXPIRED nobody paid — the winner missed their window and so did
 *                   every bidder below them (see the second-chance cascade)
 *   CANCELLED       pulled by the seller (before any bid) or by an admin
 *
 * Only LIVE accepts bids. PAYMENT_PENDING resolves to SOLD, or back to
 * PAYMENT_PENDING for the next bidder down, or finally to PAYMENT_EXPIRED when
 * the bidders run out. Everything else is terminal.
 */
const AUCTION_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  LIVE: 'LIVE',
  ENDED_NO_BIDS: 'ENDED_NO_BIDS',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  SOLD: 'SOLD',
  PAYMENT_EXPIRED: 'PAYMENT_EXPIRED',
  CANCELLED: 'CANCELLED',
});

/** Statuses that mean the auction is finished, however it finished. */
const CLOSED_STATUSES = Object.freeze([
  AUCTION_STATUS.ENDED_NO_BIDS,
  AUCTION_STATUS.PAYMENT_PENDING,
  AUCTION_STATUS.SOLD,
  AUCTION_STATUS.PAYMENT_EXPIRED,
  AUCTION_STATUS.CANCELLED,
]);

/**
 * What a single bid is now worth to its bidder.
 *
 *   HIGHEST  currently winning (what the brief calls HIGHEST/ACTIVE — one
 *            state, not two: a bid is either top of the book or it is not)
 *   OUTBID   beaten by a later bid while the auction was still running
 *   WON      currently holds the device — either highest when the auction
 *            closed, or offered it after everyone above them failed to pay
 *   LOST     not highest at close, and not (yet) offered a second chance
 *   EXPIRED  was offered the device and did not pay inside their window, so it
 *            passed to the next bidder down
 */
const BID_STATUS = Object.freeze({
  HIGHEST: 'HIGHEST',
  OUTBID: 'OUTBID',
  WON: 'WON',
  LOST: 'LOST',
  EXPIRED: 'EXPIRED',
});

/** Bid states that mean the auction is still running for this bidder. */
const ONGOING_BID_STATUSES = Object.freeze([BID_STATUS.HIGHEST, BID_STATUS.OUTBID]);

/** Seller-declared handset condition. Ordered best to worst. */
const DEVICE_CONDITION = Object.freeze({
  LIKE_NEW: 'LIKE_NEW',
  EXCELLENT: 'EXCELLENT',
  GOOD: 'GOOD',
  FAIR: 'FAIR',
  POOR: 'POOR',
});

/**
 * Whether the listing carries a real diagnosis run. Denormalised onto the
 * auction so the live-auction filter can use an index instead of joining every
 * DiagnoseSession on every page of results.
 */
const DIAGNOSTIC_STATUS = Object.freeze({
  VERIFIED: 'VERIFIED',
  UNVERIFIED: 'UNVERIFIED',
});

/**
 * Who is selling. Grest's own refurbished stock is listed from the admin
 * portal; a vendor lists their own device through the app.
 *
 * The distinction matters for money, not display: a PLATFORM listing is never
 * charged a listing credit (Grest billing itself is meaningless), and a VENDOR
 * sale leaves Grest holding the buyer's payment on the vendor's behalf until it
 * is settled out of band.
 */
const SELLER_TYPE = Object.freeze({
  PLATFORM: 'PLATFORM',
  VENDOR: 'VENDOR',
});

/** How a buyer came to own the device. */
const ORDER_SOURCE = Object.freeze({
  AUCTION_WIN: 'AUCTION_WIN',
  BUY_NOW: 'BUY_NOW',
});

/**
 * Where an order is in getting to the buyer. Grest ships everything, however
 * the device was listed, so there is one fulfilment flow rather than one per
 * seller type.
 */
const FULFILMENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  DISPATCHED: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
});

/** Sort orders offered on the live-auction list. */
const AUCTION_SORT = Object.freeze({
  ENDING_SOON: 'ENDING_SOON',
  NEWEST: 'NEWEST',
  PRICE_LOW: 'PRICE_LOW',
  PRICE_HIGH: 'PRICE_HIGH',
  MOST_BIDS: 'MOST_BIDS',
});

module.exports = {
  AUCTION_STATUS,
  CLOSED_STATUSES,
  BID_STATUS,
  ONGOING_BID_STATUSES,
  DEVICE_CONDITION,
  DIAGNOSTIC_STATUS,
  SELLER_TYPE,
  ORDER_SOURCE,
  FULFILMENT_STATUS,
  AUCTION_SORT,
};
