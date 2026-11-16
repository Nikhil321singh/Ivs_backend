/* One-off write: set createdAt of every LIVE-auction bid to today 5:30 PM IST.
   Run: node scripts/set-bid-times.js */
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const Auction = require('../src/models/Auction.model');
const Bid = require('../src/models/Bid.model');
const { AUCTION_STATUS } = require('../src/constants/auctionEnums');

const AT = new Date('2026-11-03T12:00:00.000Z'); // 5:30 PM IST

(async () => {
  await connectDB();

  const ids = await Auction.find({ status: AUCTION_STATUS.LIVE }).distinct('_id');
  // native driver: mongoose silently drops createdAt from $set on managed timestamps
  const res = await Bid.collection.updateMany(
    { auctionId: { $in: ids } },
    { $set: { createdAt: AT } },
  );
  console.log(`Set ${res.modifiedCount} bid(s) to ${AT.toISOString()} (5:30 PM IST).`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
