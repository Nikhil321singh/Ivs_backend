/**
 * Awards a closed auction to its current top bid — i.e. "make the last bid won".
 * Mirrors the winner branch of auctionCloser.service.js, but recomputes the top
 * of the book FRESH from the Bid ledger (the source of truth) rather than
 * trusting the cached currentBidId, which can go stale after a manual bid edit.
 *
 * Sets on the auction: status=PAYMENT_PENDING, winnerId, winningBidId,
 * currentBidId/currentBidderId/currentBidPaise, salePricePaise, closedAt,
 * paymentDueAt. Flips the top bid -> WON and every other bid -> LOST.
 *
 * DRY-RUN by default; pass --apply to write.
 *
 *   node scripts/award-auction.js --auction 6ac60272...            # preview
 *   node scripts/award-auction.js --auction 6ac60272... --apply    # commit
 *   node scripts/award-auction.js --auction 6ac60272... --sold --apply  # mark SOLD/paid
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User.model');
const Auction = require('../src/models/Auction.model');
const Bid = require('../src/models/Bid.model');
const settingsService = require('../src/services/settings.service');
const { SETTING_KEYS } = require('../src/constants/settings');
const { AUCTION_STATUS, BID_STATUS } = require('../src/constants/auctionEnums');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const has = (name) => process.argv.includes(`--${name}`);

const APPLY = has('apply');
const SOLD = has('sold');
const AUCTION_ID = arg('auction');

const inr = (p) => (p == null ? '—' : `₹${(p / 100).toLocaleString('en-IN')}`);

const run = async () => {
  if (!AUCTION_ID) throw new Error('Pass --auction <id>.');
  await mongoose.connect(env.mongodbUri);

  const auction = await Auction.findById(AUCTION_ID);
  if (!auction) throw new Error(`No auction ${AUCTION_ID}`);

  // Source of truth: the top surviving bid, highest amount, earliest if tied.
  const bids = await Bid.find({ auctionId: auction._id }).sort({ amountPaise: -1, createdAt: 1 });
  if (!bids.length) throw new Error('Auction has no bids to award.');
  const top = bids[0];
  const winner = await User.findById(top.bidderId, 'name mobile').lean();

  const now = new Date();
  const windowH = await settingsService.get(SETTING_KEYS.AUCTION_PAYMENT_WINDOW_HOURS);

  console.log(`\nAuction ${auction._id}`);
  console.log(`  before: status=${auction.status} winnerId=${auction.winnerId || '—'} winningBidId=${auction.winningBidId || '—'} salePrice=${inr(auction.salePricePaise)}`);
  console.log(`  top bid: _id=${top._id} ${inr(top.amountPaise)} by ${winner?.name || '?'} ${winner?.mobile || ''} (currently ${top.status})`);
  console.log(`  -> status=${SOLD ? 'SOLD' : 'PAYMENT_PENDING'} winnerId=${top.bidderId} winningBidId=${top._id} salePrice=${inr(top.amountPaise)}`);
  console.log(`  -> bid ${top._id} => WON; ${bids.length - 1} other bid(s) => LOST`);

  if (!APPLY) {
    console.log('\n(dry run — re-run with --apply to write)');
    await mongoose.disconnect();
    return;
  }

  auction.status = SOLD ? AUCTION_STATUS.SOLD : AUCTION_STATUS.PAYMENT_PENDING;
  auction.winnerId = top.bidderId;
  auction.winningBidId = top._id;
  auction.currentBidId = top._id;
  auction.currentBidderId = top.bidderId;
  auction.currentBidPaise = top.amountPaise;
  auction.salePricePaise = top.amountPaise;
  auction.bidCount = bids.length;
  auction.closedAt = auction.closedAt || now;
  if (SOLD) {
    auction.soldAt = now;
    auction.paymentDueAt = null;
  } else {
    auction.paymentDueAt = new Date(now.getTime() + windowH * 60 * 60 * 1000);
    auction.soldAt = null;
  }
  await auction.save();

  await Bid.updateOne({ _id: top._id }, { status: BID_STATUS.WON });
  await Bid.updateMany(
    { auctionId: auction._id, _id: { $ne: top._id } },
    { status: BID_STATUS.LOST }
  );

  console.log('\n✅ Done.');
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
