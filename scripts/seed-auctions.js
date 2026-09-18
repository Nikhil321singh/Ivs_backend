/**
 * Seeds real auction + bid data for front-end demos and prints a ready-to-use
 * access token for a buyer account, so the partners web app can hit the live
 * /auctions API without going through the OTP flow.
 *
 *   node scripts/seed-auctions.js
 *
 * Idempotent: every auction it creates is tagged in conditionNotes with the
 * marker below, and re-running deletes the previous batch (and their bids)
 * before recreating — so it never piles up duplicates.
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User.model');
const Auction = require('../src/models/Auction.model');
const Bid = require('../src/models/Bid.model');
const tokenService = require('../src/services/token.service');
const entitlementService = require('../src/services/entitlement.service');
const referralService = require('../src/services/referral.service');
const USER_STATUS = require('../src/constants/userStatus');
const USER_TYPE = require('../src/constants/userType');
const { AUCTION_STATUS, BID_STATUS, DEVICE_CONDITION, DIAGNOSTIC_STATUS } = require('../src/constants/auctionEnums');

const MARKER = '[seed-demo]';
const rupees = (inr) => inr * 100;
const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);

// Real, stable device photos (Unsplash direct CDN URLs).
const PHOTO = {
  iphone15pro: 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&q=80',
  iphone14: 'https://images.unsplash.com/photo-1678652197831-2d180705cd2c?w=600&q=80',
  s23ultra: 'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=600&q=80',
  oneplus: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&q=80',
  pixel: 'https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=600&q=80',
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

async function makeAuction(seller, data) {
  return Auction.create({
    sellerId: seller._id,
    status: data.status || AUCTION_STATUS.LIVE,
    device: data.device,
    condition: data.condition,
    conditionNotes: `${MARKER} ${data.notes || ''}`.trim(),
    photos: [photoObj(data.photo)],
    diagnosticStatus: data.diagnosticStatus || DIAGNOSTIC_STATUS.VERIFIED,
    imeiStatus: 'CLEAN',
    startPricePaise: rupees(data.startInr),
    bidIncrementPaise: rupees(data.incrementInr || 500),
    startAt: hoursFromNow(-2),
    // endsInH is treated as DAYS so demo auctions stay live for days, not hours.
    endAt: data.endAt || hoursFromNow((data.endsInH || 6) * 24),
    currentBidPaise: data.currentBidInr ? rupees(data.currentBidInr) : null,
    currentBidderId: data.currentBidderId || null,
    bidCount: data.bidCount || 0,
    winnerId: data.winnerId || null,
    closedAt: data.closedAt || null,
    paymentDueAt: data.paymentDueAt || null,
    soldAt: data.soldAt || null,
  });
}

const seed = async () => {
  await mongoose.connect(env.mongodbUri);

  // wipe previous demo batch
  const old = await Auction.find({ conditionNotes: new RegExp(MARKER.replace(/[[\]]/g, '\\$&')) }, '_id');
  const oldIds = old.map((a) => a._id);
  if (oldIds.length) {
    await Bid.deleteMany({ auctionId: { $in: oldIds } });
    await Auction.deleteMany({ _id: { $in: oldIds } });
  }

  const seller = await ensureUser('Sharma Mobile', '9700000001');
  const buyer = await ensureUser('Test Buyer', '9700000002');
  const rival = await ensureUser('Rival Bidder', '9700000003');

  // Listing credits so the buyer/seller can publish a listing (publish charges
  // one AUCTION_LISTING credit under SUBSCRIPTION billing). Idempotent per run.
  const creditRun = Date.now()
  for (const u of [buyer, seller]) {
    await entitlementService.credit(u._id, 'AUCTION_LISTING', 10, {
      idempotencyKey: `seed-listing-credit-${u._id}-${creditRun}`,
    })
  }

  // ---- Browse-only live auctions (no buyer bid) — iPhones only ---------
  await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone 15 Pro Max', storageGb: 256, color: 'Natural Titanium', imei: '355301083783251' }, condition: DEVICE_CONDITION.LIKE_NEW, photo: PHOTO.iphone15pro, startInr: 82000, currentBidInr: 89500, bidCount: 12, endsInH: 2 });
  await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone 15 Pro', storageGb: 128, color: 'Blue Titanium', imei: '355301083783252' }, condition: DEVICE_CONDITION.EXCELLENT, photo: PHOTO.iphone15pro, startInr: 62000, currentBidInr: 68900, bidCount: 8, endsInH: 5 });
  await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone 14', storageGb: 128, color: 'Blue', imei: '355301083783253' }, condition: DEVICE_CONDITION.GOOD, photo: PHOTO.iphone14, startInr: 42000, currentBidInr: 48200, bidCount: 5, endsInH: 1, diagnosticStatus: DIAGNOSTIC_STATUS.UNVERIFIED });
  await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone 13', storageGb: 128, color: 'Midnight', imei: '355301083783254' }, condition: DEVICE_CONDITION.EXCELLENT, photo: PHOTO.iphone14, startInr: 34000, currentBidInr: 39900, bidCount: 4, endsInH: 8 });
  await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone SE (3rd gen)', storageGb: 64, color: 'Starlight', imei: '355301083783255' }, condition: DEVICE_CONDITION.GOOD, photo: PHOTO.iphone14, startInr: 18000, bidCount: 0, endsInH: 12 });

  // ---- Buyer: ONGOING (highest) ---------------------------------------
  const aHighest = await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone 15 Pro', storageGb: 256, color: 'Blue Titanium', imei: '355301083783261' }, condition: DEVICE_CONDITION.LIKE_NEW, photo: PHOTO.iphone15pro, startInr: 70000, currentBidInr: 74500, currentBidderId: buyer._id, bidCount: 1, endsInH: 3, notes: 'ongoing-highest' });
  await Bid.create({ auctionId: aHighest._id, bidderId: buyer._id, amountPaise: rupees(74500), status: BID_STATUS.HIGHEST });

  // ---- Buyer: ONGOING (outbid by rival) -------------------------------
  const aOutbid = await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone 14 Pro', storageGb: 256, color: 'Deep Purple', imei: '355301083783262' }, condition: DEVICE_CONDITION.GOOD, photo: PHOTO.iphone14, startInr: 55000, currentBidInr: 61000, currentBidderId: rival._id, bidCount: 2, endsInH: 5, notes: 'ongoing-outbid' });
  await Bid.create({ auctionId: aOutbid._id, bidderId: buyer._id, amountPaise: rupees(60500), status: BID_STATUS.OUTBID });
  await Bid.create({ auctionId: aOutbid._id, bidderId: rival._id, amountPaise: rupees(61000), status: BID_STATUS.HIGHEST });

  // ---- Buyer: WON (auction sold to buyer) -----------------------------
  const aWon = await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone 15 Pro', storageGb: 256, color: 'Natural Titanium', imei: '355301083783263' }, condition: DEVICE_CONDITION.EXCELLENT, photo: PHOTO.iphone15pro, startInr: 70000, currentBidInr: 72500, currentBidderId: buyer._id, bidCount: 1, status: AUCTION_STATUS.PAYMENT_PENDING, winnerId: buyer._id, closedAt: hoursFromNow(-1), paymentDueAt: hoursFromNow(23), endAt: hoursFromNow(-1), notes: 'won' });
  await Bid.create({ auctionId: aWon._id, bidderId: buyer._id, amountPaise: rupees(72500), status: BID_STATUS.WON });

  // ---- Buyer: LOST (rival won) ----------------------------------------
  const aLost = await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone 13 Pro', storageGb: 256, color: 'Graphite', imei: '355301083783264' }, condition: DEVICE_CONDITION.GOOD, photo: PHOTO.iphone14, startInr: 42000, currentBidInr: 47000, currentBidderId: rival._id, bidCount: 2, status: AUCTION_STATUS.SOLD, winnerId: rival._id, closedAt: hoursFromNow(-2), soldAt: hoursFromNow(-1), endAt: hoursFromNow(-2), notes: 'lost' });
  await Bid.create({ auctionId: aLost._id, bidderId: buyer._id, amountPaise: rupees(45000), status: BID_STATUS.LOST });
  await Bid.create({ auctionId: aLost._id, bidderId: rival._id, amountPaise: rupees(47000), status: BID_STATUS.WON });

  const { accessToken, refreshToken } = await tokenService.issueTokenPair(buyer, 'seed-web');

  const liveCount = await Auction.countDocuments({ status: AUCTION_STATUS.LIVE, conditionNotes: new RegExp(MARKER.replace(/[[\]]/g, '\\$&')) });

  /* eslint-disable no-console */
  console.log('\n✅ Seeded auctions. Live now:', liveCount);
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
