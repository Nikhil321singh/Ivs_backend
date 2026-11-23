/**
 * Immediately passes the payment offer to the next eligible bidder.
 *
 * Usage:
 *   node scripts/pass-offer.js <auctionId>
 *
 *   # or find by phone number of the next bidder you want to reach:
 *   node scripts/pass-offer.js --phone 7015896661
 *
 * Use when the current winner refuses to pay and you want to offer
 * the device to the next bidder without waiting for the window to lapse.
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const Auction = require('../src/models/Auction.model');
const Bid = require('../src/models/Bid.model');
const User = require('../src/models/User.model');
const auctionCloser = require('../src/services/auctionCloser.service');
const settingsService = require('../src/services/settings.service');
const { SETTING_KEYS } = require('../src/constants/settings');
const { AUCTION_STATUS } = require('../src/constants/auctionEnums');

/* eslint-disable no-console */

const run = async () => {
  await mongoose.connect(env.mongodbUri);

  const args = process.argv.slice(2);

  let auction;

  if (args[0] === '--phone') {
    const phone = args[1];
    if (!phone) {
      console.error('Usage: node scripts/pass-offer.js --phone <mobile>');
      process.exit(1);
    }

    // Find the user with this phone
    const user = await User.findOne({ mobile: phone }).lean();
    if (!user) {
      console.error(`No user found with mobile ${phone}`);
      process.exit(1);
    }
    console.log(`Found user: ${user.name || user.companyName || user.mobile} (${user._id})`);

    // Find a PAYMENT_PENDING auction where this user has a bid (but is not the current winner)
    const bids = await Bid.find({ bidderId: user._id }).distinct('auctionId');
    auction = await Auction.findOne({
      _id: { $in: bids },
      status: AUCTION_STATUS.PAYMENT_PENDING,
      winnerId: { $ne: user._id },
    })
      .populate('winnerId', 'name mobile companyName')
      .lean();

    if (!auction) {
      console.error(`No PAYMENT_PENDING auction found where ${phone} is a non-winning bidder.`);
      console.error('The auction may already be SOLD or PAYMENT_EXPIRED, or this user may be the current winner.');
      process.exit(1);
    }
  } else if (args[0]) {
    auction = await Auction.findById(args[0])
      .populate('winnerId', 'name mobile companyName')
      .lean();

    if (!auction) {
      console.error(`Auction ${args[0]} not found.`);
      process.exit(1);
    }
    if (auction.status !== AUCTION_STATUS.PAYMENT_PENDING || !auction.winnerId) {
      console.error(`Auction is ${auction.status} — must be PAYMENT_PENDING with an active winner.`);
      process.exit(1);
    }
  } else {
    console.error('Usage:');
    console.error('  node scripts/pass-offer.js <auctionId>');
    console.error('  node scripts/pass-offer.js --phone <mobile>');
    process.exit(1);
  }

  const label = `${auction.device?.brand || ''} ${auction.device?.model || ''}`.trim() || 'device';
  const winner = auction.winnerId;
  console.log(`\nAuction:  ${auction._id}`);
  console.log(`Device:   ${label}`);
  console.log(`Current winner (refusing to pay): ${winner?.name || winner?.companyName || '?'} (${winner?.mobile})`);
  console.log(`Payment due: ${auction.paymentDueAt}`);
  console.log('');

  const [windowHours, secondChance] = await Promise.all([
    settingsService.get(SETTING_KEYS.AUCTION_PAYMENT_WINDOW_HOURS),
    settingsService.get(SETTING_KEYS.AUCTION_SECOND_CHANCE_ENABLED),
  ]);

  // Force paymentDueAt into the past so passOfferDown's atomic filter matches
  await Auction.updateOne(
    { _id: auction._id, status: AUCTION_STATUS.PAYMENT_PENDING, winnerId: auction.winnerId },
    { paymentDueAt: new Date(0) }
  );

  const now = new Date();
  const result = await auctionCloser.passOfferDown(
    { ...auction, paymentDueAt: new Date(0) },
    { now, windowHours, secondChance: secondChance === true }
  );

  if (!result) {
    console.error('passOfferDown returned null — the auction may have already moved on.');
    process.exit(1);
  }

  console.log(`Done. Auction is now: ${result.status}`);
  if (result.winnerId) {
    const nextWinner = await User.findById(result.winnerId).lean();
    console.log(`Next bidder offered: ${nextWinner?.name || nextWinner?.companyName || '?'} (${nextWinner?.mobile})`);
    console.log(`Their price: ₹${(result.salePricePaise / 100).toLocaleString('en-IN')}`);
    console.log(`Payment due by: ${result.paymentDueAt}`);
  } else {
    console.log('No further bidders — auction moved to PAYMENT_EXPIRED.');
  }
  console.log('');

  await mongoose.disconnect();
};
/* eslint-enable no-console */

run().catch(async (err) => {
  console.error('Failed:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});
