/* One-off write: set endAt of every LIVE auction to today 5:30 PM IST.
   Run: node scripts/set-auction-end.js */
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const Auction = require('../src/models/Auction.model');
const { AUCTION_STATUS } = require('../src/constants/auctionEnums');

const AT = new Date('2026-11-03T12:00:00.000Z'); // 5:30 PM IST

(async () => {
  await connectDB();

  const res = await Auction.updateMany(
    { status: AUCTION_STATUS.LIVE },
    { $set: { endAt: AT } },
  );
  console.log(`Set ${res.modifiedCount} auction(s) to end ${AT.toISOString()} (5:30 PM IST).`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
