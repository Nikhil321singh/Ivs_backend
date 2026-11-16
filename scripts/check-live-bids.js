/* One-off read-only: list every LIVE auction with its bids.
   Run: node scripts/check-live-bids.js */
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const Auction = require('../src/models/Auction.model');
const Bid = require('../src/models/Bid.model');
const { AUCTION_STATUS } = require('../src/constants/auctionEnums');

const rupees = (p) => '₹' + (p / 100).toLocaleString('en-IN');

(async () => {
  await connectDB();

  const live = await Auction.find({ status: AUCTION_STATUS.LIVE }).sort({ endAt: 1 }).lean();
  console.log(`\n${live.length} LIVE auction(s):\n`);

  for (const a of live) {
    const bids = await Bid.find({ auctionId: a._id }).sort({ amountPaise: -1 }).lean();
    const top = bids[0];
    console.log(`• ${a.device.brand} ${a.device.model}  [${a._id}]`);
    console.log(`    base ${rupees(a.startPricePaise)} | bids ${a.bidCount} | top ${top ? rupees(top.amountPaise) : '—'} | ends ${a.endAt.toISOString()}`);
    for (const b of bids) {
      console.log(`      ${rupees(b.amountPaise)}  ${b.status}  bidder=${b.bidderId}  ${b.createdAt.toISOString()}`);
    }
  }

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
