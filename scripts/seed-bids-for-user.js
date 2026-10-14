/**
 * Seeds WON / LOST / ONGOING bids for an existing (real) user so their
 * My Bids tabs (Successful / Unsuccessful / Ongoing) are populated.
 *
 *   node scripts/seed-bids-for-user.js --mobile 9988331757
 *
 * Idempotent: tagged in conditionNotes with the marker below; re-running
 * deletes the previous batch (and their bids) first.
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User.model');
const Auction = require('../src/models/Auction.model');
const Bid = require('../src/models/Bid.model');
const referralService = require('../src/services/referral.service');
const USER_STATUS = require('../src/constants/userStatus');
const USER_TYPE = require('../src/constants/userType');
const { AUCTION_STATUS, BID_STATUS, DEVICE_CONDITION, DIAGNOSTIC_STATUS } = require('../src/constants/auctionEnums');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const MOBILE = arg('mobile') || '9988331757';

const rupees = (inr) => inr * 100;
const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);

const PHOTO = {
  iphone15pro: 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&q=80',
  iphone14: 'https://images.unsplash.com/photo-1678652197831-2d180705cd2c?w=600&q=80',
};
const photoObj = (url) => ({ url, publicId: `seed/${url.split('/').pop().split('?')[0]}` });

async function ensureUser(name, mobile) {
  let user = await User.findOne({ mobile });
  if (!user) user = new User({ countryCode: env.defaultCountryCode, mobile });
  if (!user.referralCode) user.referralCode = await referralService.generateUniqueReferralCode();
  if (!user.name) user.name = name;
  user.userType = USER_TYPE.INDIVIDUAL;
  user.isMobileVerified = true;
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
    diagnosticStatus: DIAGNOSTIC_STATUS.VERIFIED,
    imeiStatus: 'CLEAN',
    startPricePaise: rupees(data.startInr),
    bidIncrementPaise: rupees(500),
    startAt: hoursFromNow(-2),
    endAt: data.endAt || hoursFromNow((data.endsInH || 72)),
    currentBidPaise: data.currentBidInr ? rupees(data.currentBidInr) : null,
    currentBidderId: data.currentBidderId || null,
    bidCount: data.bidCount || 1,
    winnerId: data.winnerId || null,
    closedAt: data.closedAt || null,
    paymentDueAt: data.paymentDueAt || null,
    soldAt: data.soldAt || null,
  });
}

const MARKER = '[seed-user-bids]';

const seed = async () => {
  await mongoose.connect(env.mongodbUri);

  const buyer = await User.findOne({ mobile: MOBILE });
  if (!buyer) throw new Error(`No user with mobile ${MOBILE}`);

  const seller = await ensureUser('Sharma Mobile', '9700000001');
  const rival = await ensureUser('Rival Bidder', '9700000003');

  // wipe previous batch for this marker
  const old = await Auction.find({ conditionNotes: new RegExp(MARKER.replace(/[[\]]/g, '\\$&')) }, '_id');
  const oldIds = old.map((a) => a._id);
  if (oldIds.length) {
    await Bid.deleteMany({ auctionId: { $in: oldIds } });
    await Auction.deleteMany({ _id: { $in: oldIds } });
  }

  // WON x2 (one payment-pending, one sold/paid)
  const aWon1 = await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone 15 Pro', storageGb: 256, color: 'Natural Titanium', imei: '355301083784001' }, condition: DEVICE_CONDITION.EXCELLENT, photo: PHOTO.iphone15pro, startInr: 70000, currentBidInr: 72500, currentBidderId: buyer._id, status: AUCTION_STATUS.PAYMENT_PENDING, winnerId: buyer._id, closedAt: hoursFromNow(-1), paymentDueAt: hoursFromNow(23), endAt: hoursFromNow(-1), notes: 'won-1' });
  await Bid.create({ auctionId: aWon1._id, bidderId: buyer._id, amountPaise: rupees(72500), status: BID_STATUS.WON });

  const aWon2 = await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone 14', storageGb: 256, color: 'Purple', imei: '355301083784002' }, condition: DEVICE_CONDITION.EXCELLENT, photo: PHOTO.iphone14, startInr: 45000, currentBidInr: 51000, currentBidderId: buyer._id, status: AUCTION_STATUS.SOLD, winnerId: buyer._id, closedAt: hoursFromNow(-30), soldAt: hoursFromNow(-29), endAt: hoursFromNow(-30), notes: 'won-2' });
  await Bid.create({ auctionId: aWon2._id, bidderId: buyer._id, amountPaise: rupees(51000), status: BID_STATUS.WON });

  // LOST x2
  const aLost1 = await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone 13 Pro', storageGb: 256, color: 'Graphite', imei: '355301083784003' }, condition: DEVICE_CONDITION.GOOD, photo: PHOTO.iphone14, startInr: 42000, currentBidInr: 47000, currentBidderId: rival._id, bidCount: 2, status: AUCTION_STATUS.SOLD, winnerId: rival._id, closedAt: hoursFromNow(-2), soldAt: hoursFromNow(-1), endAt: hoursFromNow(-2), notes: 'lost-1' });
  await Bid.create({ auctionId: aLost1._id, bidderId: buyer._id, amountPaise: rupees(45000), status: BID_STATUS.LOST });
  await Bid.create({ auctionId: aLost1._id, bidderId: rival._id, amountPaise: rupees(47000), status: BID_STATUS.WON });

  const aLost2 = await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone 15', storageGb: 128, color: 'Pink', imei: '355301083784004' }, condition: DEVICE_CONDITION.LIKE_NEW, photo: PHOTO.iphone15pro, startInr: 60000, currentBidInr: 67000, currentBidderId: rival._id, bidCount: 3, status: AUCTION_STATUS.SOLD, winnerId: rival._id, closedAt: hoursFromNow(-50), soldAt: hoursFromNow(-49), endAt: hoursFromNow(-50), notes: 'lost-2' });
  await Bid.create({ auctionId: aLost2._id, bidderId: buyer._id, amountPaise: rupees(65000), status: BID_STATUS.LOST });
  await Bid.create({ auctionId: aLost2._id, bidderId: rival._id, amountPaise: rupees(67000), status: BID_STATUS.WON });

  // ONGOING x2 (highest + outbid)
  const aHigh = await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone 15 Pro', storageGb: 256, color: 'Blue Titanium', imei: '355301083784005' }, condition: DEVICE_CONDITION.LIKE_NEW, photo: PHOTO.iphone15pro, startInr: 70000, currentBidInr: 74500, currentBidderId: buyer._id, endsInH: 72, notes: 'ongoing-highest' });
  await Bid.create({ auctionId: aHigh._id, bidderId: buyer._id, amountPaise: rupees(74500), status: BID_STATUS.HIGHEST });

  const aOut = await makeAuction(seller, { device: { brand: 'Apple', model: 'iPhone 14 Pro', storageGb: 256, color: 'Deep Purple', imei: '355301083784006' }, condition: DEVICE_CONDITION.GOOD, photo: PHOTO.iphone14, startInr: 55000, currentBidInr: 61000, currentBidderId: rival._id, bidCount: 2, endsInH: 120, notes: 'ongoing-outbid' });
  await Bid.create({ auctionId: aOut._id, bidderId: buyer._id, amountPaise: rupees(60500), status: BID_STATUS.OUTBID });
  await Bid.create({ auctionId: aOut._id, bidderId: rival._id, amountPaise: rupees(61000), status: BID_STATUS.HIGHEST });

  /* eslint-disable no-console */
  console.log(`\n✅ Seeded bids for ${buyer.countryCode || ''}${buyer.mobile} (${buyer._id})`);
  console.log('   Successful (won): 2 | Unsuccessful (lost): 2 | Ongoing: 2');
  await mongoose.disconnect();
};

seed().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
