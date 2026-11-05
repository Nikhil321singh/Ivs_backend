/* One-off: back the 12 manual sales with real Payment rows so the admin shows
   the IMPS transaction number (admin reads it from Payment.razorpayPaymentId).
   Creates 3 Payments (one per receipt), links each order + auction to its payment.
   Dry by default. Apply with --commit.
   Run: node scripts/link-imps-payments.js [--commit] */
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const Auction = require('../src/models/Auction.model');
const Order = require('../src/models/Order.model');
const Payment = require('../src/models/Payment.model');
const { PAYMENT_PURPOSE } = require('../src/constants/entitlementEnums');
const { PAYMENT_STATUS } = require('../src/constants/walletEnums');

const BUYER_ID = '6a7da994d45d51f693f0584c'; // Shakti enterprises

const TXNS = [
  { txn: 'Y2M1333425626375262208', ref: '630718944191', amount: 10600000, label: '03/11/2026 06:09 PM' },
  { txn: 'Y2M1333426819872854016', ref: '630718949095', amount: 5000000, label: '03/11/2026 06:14 PM' },
  { txn: 'Y2M1331931745682984960', ref: '630315515844', amount: 10000000, label: '30/10/2026 03:13 PM' },
];

const rupees = (p) => '₹' + (p / 100).toLocaleString('en-IN');
const COMMIT = process.argv.includes('--commit');

(async () => {
  await connectDB();

  // Our 12 orders — the ones stamped with an IMPS note earlier.
  const orders = await Order.find({ buyerId: BUYER_ID, 'notes.text': /IMPS Y2M133/ }).lean();
  console.log(`${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${orders.length} manual order(s) to back with payments.\n`);

  for (const t of TXNS) {
    const mine = orders.filter((o) => o.notes.some((n) => n.text.includes(t.txn)));
    console.log(`${t.txn}  ${rupees(t.amount)}  → ${mine.length} order(s)`);

    if (!COMMIT) continue;

    // One Payment per receipt. razorpayPaymentId carries the IMPS txn number
    // (the "transaction number" the admin surfaces); razorpayOrderId must be
    // unique, so key it off the txn. Not a Razorpay capture — flagged in notes.
    let pay = await Payment.findOne({ razorpayPaymentId: t.txn });
    if (!pay) {
      pay = await Payment.create({
        userId: BUYER_ID,
        razorpayOrderId: `imps_${t.txn}`,
        razorpayPaymentId: t.txn,
        amountPaise: t.amount,
        currency: 'INR',
        purpose: PAYMENT_PURPOSE.AUCTION,
        status: PAYMENT_STATUS.PAID,
        notes: { source: 'IMPS', ref: t.ref, when: t.label,
          from: 'YONO SBI MANOJ JOSHI / Shakti enterprises', to: 'Redical aftermarket ltd (ICICI)' },
      });
    }

    const oid = mine.map((o) => o._id);
    const aid = mine.map((o) => o.auctionId);
    await Order.updateMany({ _id: { $in: oid } }, { $set: { paymentId: pay._id } });
    await Auction.updateMany({ _id: { $in: aid } }, { $set: { paymentId: pay._id } });
    console.log(`   Payment ${pay._id} linked to ${oid.length} order(s) + auction(s).`);
  }

  console.log(COMMIT ? '\nCommitted.' : '\nDry run only — no writes. Re-run with --commit to apply.');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
