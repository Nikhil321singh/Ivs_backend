/**
 * Seeds CHEAP auctions for real-money payment + countdown testing:
 *   • 6  instant-buy   — ₹1 start / ₹5 buy-now, live ~6h
 *   • 3  5-minute      — ₹1 start / ₹5 buy-now, ends in 5 min
 *   • 3  24-hour       — ₹1 start / ₹5 buy-now, ends in 24 h
 * Every auction is buy-now-able for ₹5 so a real Razorpay payment can be tested
 * at a trivial amount. Prints a buyer access token for the app.
 *
 *   MONGODB_URI='<testing uri>' node scripts/seed-cheap-auctions.js
 *
 * ALWAYS pass the testing MONGODB_URI inline — the repo .env points at the prod
 * cluster. Idempotent: tagged with the marker below and re-run wipes its own
 * batch (+ bids) first, so it never duplicates and never touches other seeds.
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User.model');
const Auction = require('../src/models/Auction.model');
const Bid = require('../src/models/Bid.model');
const tokenService = require('../src/services/token.service');
const referralService = require('../src/services/referral.service');
const USER_STATUS = require('../src/constants/userStatus');
const USER_TYPE = require('../src/constants/userType');
const { AUCTION_STATUS, DEVICE_CONDITION, DIAGNOSTIC_STATUS } = require('../src/constants/auctionEnums');

const MARKER = '[seed-cheap]';
const rupees = (inr) => inr * 100;
const minsFromNow = (mins) => new Date(Date.now() + mins * 60 * 1000);

const PHOTO = {
  iphone15pro: 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&q=80',
  iphone14: 'https://images.unsplash.com/photo-1678652197831-2d180705cd2c?w=600&q=80',
};
const photoObj = (url) => ({ url, publicId: `seed/${url.split('/').pop().split('?')[0]}` });

async function ensureUser(name, mobile) {
  let user = await User.findOne({ countryCode: env.defaultCountryCode, mobile });
  if (!user) user = new User({ countryCode: env.defaultCountryCode, mobile });
  if (!user.referralCode) user.referralCode = await referralService.generateUniqueReferralCode();
  user.name = name;
  user.userType = USER_TYPE.INDIVIDUAL;
  user.phone = mobile;
  if (!user.email) user.email = `seed+${mobile}@example.com`;
  user.isMobileVerified = true;
  user.aadhaarVerified = true;
  user.kycCompleted = true;
  user.status = USER_STATUS.ACTIVE;
  await user.save();
  return user;
}

let imeiSeq = 355301090000001;
function makeAuction(seller, { model, storageGb, color, photo, endAt, note }) {
  return Auction.create({
    sellerId: seller._id,
    status: AUCTION_STATUS.LIVE,
    device: { brand: 'Apple', model, storageGb, color, imei: String(imeiSeq++) },
    condition: DEVICE_CONDITION.A_PLUS,
    conditionNotes: `${MARKER} ${note}`.trim(),
    photos: [photoObj(photo)],
    diagnosticStatus: DIAGNOSTIC_STATUS.VERIFIED,
    imeiStatus: 'CLEAN',
    startPricePaise: rupees(1),       // ₹1 start
    bidIncrementPaise: rupees(1),     // ₹1 increment
    buyNowPricePaise: rupees(5),      // ₹5 instant buy (must be > start)
    startAt: minsFromNow(-120),
    endAt,
    currentBidPaise: null,
    bidCount: 0,
  });
}

const seed = async () => {
  await mongoose.connect(env.mongodbUri);
  const host = env.mongodbUri.replace(/\/\/[^@]*@/, '//***@');
  console.log('Connected:', host, '| db:', mongoose.connection.db.databaseName);
  if (/cluster0\.a5plujs/.test(env.mongodbUri)) {
    throw new Error('Refusing to seed: this is the PROD cluster. Pass the testing MONGODB_URI inline.');
  }

  // wipe previous [seed-cheap] batch + their bids
  const old = await Auction.find({ conditionNotes: new RegExp(MARKER.replace(/[[\]]/g, '\\$&')) }, '_id');
  const oldIds = old.map((a) => a._id);
  if (oldIds.length) {
    await Bid.deleteMany({ auctionId: { $in: oldIds } });
    await Auction.deleteMany({ _id: { $in: oldIds } });
    console.log('Wiped previous batch:', oldIds.length);
  }

  const seller = await ensureUser('Cheap Seller', '9700000011');
  const buyer = await ensureUser('Test Buyer', '9700000002');

  const spec = [
    ...Array.from({ length: 6 }, (_, i) => ({
      model: 'iPhone 15 Pro', storageGb: 256, color: 'Natural Titanium', photo: PHOTO.iphone15pro,
      endAt: minsFromNow(6 * 60), note: `instant-buy-${i + 1}`,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      model: 'iPhone 14', storageGb: 128, color: 'Blue', photo: PHOTO.iphone14,
      endAt: minsFromNow(5), note: `5min-${i + 1}`,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      model: 'iPhone 13', storageGb: 128, color: 'Midnight', photo: PHOTO.iphone14,
      endAt: minsFromNow(24 * 60), note: `24h-${i + 1}`,
    })),
  ];

  for (const s of spec) await makeAuction(seller, s);

  const { accessToken, refreshToken } = await tokenService.issueTokenPair(buyer, 'seed-cheap');
  const live = await Auction.countDocuments({ status: AUCTION_STATUS.LIVE, conditionNotes: new RegExp(MARKER.replace(/[[\]]/g, '\\$&')) });

  /* eslint-disable no-console */
  console.log('\n✅ Seeded cheap auctions:', spec.length, '| live:', live);
  console.log('   6× instant-buy (₹1/₹5, ~6h), 3× 5-min, 3× 24-h — all ₹5 buy-now');
  console.log('\n--- Buyer session (paste into the browser to test) ---');
  console.log(JSON.stringify({
    accessToken,
    refreshToken,
    user: { id: buyer._id.toString(), name: buyer.name, mobile: buyer.mobile, kycCompleted: true },
  }, null, 2));
  await mongoose.disconnect();
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
