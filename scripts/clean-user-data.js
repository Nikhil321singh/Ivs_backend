/**
 * Reset a phone number to a brand-new state: delete the user and every
 * record that references them across all collections.
 *
 * Usage:
 *   node scripts/clean-user-data.js 9988331757          # dry run (report only)
 *   node scripts/clean-user-data.js 9988331757 --delete # actually delete
 */
require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../src/config/env');

const User = require('../src/models/User.model');
const AadhaarOtp = require('../src/models/AadhaarOtp.model');
const AadhaarVerification = require('../src/models/AadhaarVerification.model');
const Auction = require('../src/models/Auction.model');
const Bid = require('../src/models/Bid.model');
const DeviceToken = require('../src/models/DeviceToken.model');
const DiagnoseRecord = require('../src/models/DiagnoseRecord.model');
const DiagnoseSession = require('../src/models/DiagnoseSession.model');
const Entitlement = require('../src/models/Entitlement.model');
const EntitlementTransaction = require('../src/models/EntitlementTransaction.model');
const ImeiVerificationLog = require('../src/models/ImeiVerificationLog.model');
const Notification = require('../src/models/Notification.model');
const NotificationCampaign = require('../src/models/NotificationCampaign.model');
const Order = require('../src/models/Order.model');
const Otp = require('../src/models/Otp.model');
const OtpAttempt = require('../src/models/OtpAttempt.model');
const Payment = require('../src/models/Payment.model');
const ProviderRequestLog = require('../src/models/ProviderRequestLog.model');
const Referral = require('../src/models/Referral.model');
const RefreshToken = require('../src/models/RefreshToken.model');
const Wallet = require('../src/models/Wallet.model');
const WalletTransaction = require('../src/models/WalletTransaction.model');

const mobile = process.argv[2];
const DO_DELETE = process.argv.includes('--delete');

if (!mobile) {
  console.error('Provide a mobile number, e.g. node scripts/clean-user-data.js 9988331757');
  process.exit(1);
}

async function main() {
  await mongoose.connect(env.mongodbUri);
  console.log(`Connected: ${mongoose.connection.host} / db=${mongoose.connection.name}`);
  console.log(`Mode: ${DO_DELETE ? 'DELETE' : 'DRY RUN (report only)'}\n`);

  const users = await User.find({ mobile }).lean();
  const userIds = users.map((u) => u._id);
  console.log(`Users matching mobile ${mobile}: ${users.length}`);
  users.forEach((u) =>
    console.log(`  _id=${u._id} name=${u.name || '-'} type=${u.userType || '-'} status=${u.status || '-'} created=${u.createdAt}`)
  );

  // auctions owned by this user — bids/orders on those must go too
  const auctions = await Auction.find({ sellerId: { $in: userIds } }).select('_id').lean();
  const auctionIds = auctions.map((a) => a._id);

  const byUser = { userId: { $in: userIds } };

  const targets = [
    ['AadhaarOtp', AadhaarOtp, byUser],
    ['AadhaarVerification', AadhaarVerification, byUser],
    ['DeviceToken', DeviceToken, byUser],
    ['DiagnoseRecord', DiagnoseRecord, byUser],
    ['DiagnoseSession', DiagnoseSession, byUser],
    ['Entitlement', Entitlement, byUser],
    ['EntitlementTransaction', EntitlementTransaction, byUser],
    ['ImeiVerificationLog', ImeiVerificationLog, byUser],
    ['Notification', Notification, byUser],
    ['Payment', Payment, byUser],
    ['ProviderRequestLog', ProviderRequestLog, byUser],
    ['RefreshToken', RefreshToken, byUser],
    ['Wallet', Wallet, byUser],
    ['WalletTransaction', WalletTransaction, byUser],
    ['Bid (placed by user)', Bid, { bidderId: { $in: userIds } }],
    ['Bid (on user auctions)', Bid, { auctionId: { $in: auctionIds } }],
    ['Order (as buyer/seller)', Order, { $or: [{ buyerId: { $in: userIds } }, { sellerId: { $in: userIds } }] }],
    ['Auction (owned)', Auction, { sellerId: { $in: userIds } }],
    ['Referral (referrer/referee)', Referral, { $or: [{ referrerId: { $in: userIds } }, { refereeId: { $in: userIds } }] }],
    ['Otp (by mobile)', Otp, { mobile }],
    ['OtpAttempt (by mobile)', OtpAttempt, { mobile }],
  ];

  console.log('\nRelated records:');
  for (const [label, Model, filter] of targets) {
    const count = await Model.countDocuments(filter);
    console.log(`  ${label}: ${count}`);
    if (DO_DELETE && count > 0) {
      const res = await Model.deleteMany(filter);
      console.log(`    -> deleted ${res.deletedCount}`);
    }
  }

  // NotificationCampaign: pull user from userIds array rather than delete the campaign
  const campaignCount = await NotificationCampaign.countDocuments({ userIds: { $in: userIds } });
  console.log(`  NotificationCampaign (referencing user): ${campaignCount}`);
  if (DO_DELETE && campaignCount > 0) {
    const res = await NotificationCampaign.updateMany(
      { userIds: { $in: userIds } },
      { $pull: { userIds: { $in: userIds } } }
    );
    console.log(`    -> pulled from ${res.modifiedCount} campaigns`);
  }

  console.log(`\n  User: ${users.length}`);
  if (DO_DELETE && userIds.length > 0) {
    const res = await User.deleteMany({ _id: { $in: userIds } });
    console.log(`    -> deleted ${res.deletedCount} user(s)`);
  }

  await mongoose.disconnect();
  console.log(`\nDone (${DO_DELETE ? 'DELETED' : 'dry run — nothing changed'}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
