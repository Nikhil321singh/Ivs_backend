/* One-off write: sell all 12 SCHEDULED phones to Shakti enterprises at buy-now.
   Each device is allocated to the specific IMPS transaction that paid for it
   (the three receipts partition exactly into the 12 buy-now prices), and that
   txn's number + timestamp go on the device's order.
   Dry by default. Apply with --commit.
   Run: node scripts/sell-scheduled-batch.js [--commit] */
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const Auction = require('../src/models/Auction.model');
const Order = require('../src/models/Order.model');
const { AUCTION_STATUS, ORDER_SOURCE } = require('../src/constants/auctionEnums');

const BUYER_ID = '6a7da994d45d51f693f0584c'; // Shakti enterprises

// Shakti enterprises' saved address (addressSchema is _id:false — no _id here).
const SHIP = {
  name: 'Shakti enterprises', phone: '8955686559',
  line1: 'Shop no 56 Ganpati plaza bikaner', line2: 'Bikaner', landmark: 'Bikaner',
  city: 'Bikaner', state: 'Rajasthan', pincode: '334001',
};

// The 3 IMPS receipts. `needs` is the multiset of buy-now prices (paise) that
// sums exactly to the receipt amount — the allocation found by subset-partition.
const TXNS = [
  { txn: 'Y2M1333425626375262208', ref: '630718944191', amount: 10600000,
    at: new Date('2026-11-03T12:39:00.000Z'), label: '03/11/2026 06:09 PM',
    needs: [1150000, 1200000, 2250000, 6000000] },
  { txn: 'Y2M1333426819872854016', ref: '630718949095', amount: 5000000,
    at: new Date('2026-11-03T12:44:00.000Z'), label: '03/11/2026 06:14 PM',
    needs: [950000, 950000, 1750000, 1350000] },
  { txn: 'Y2M1331931745682984960', ref: '630315515844', amount: 10000000,
    at: new Date('2026-10-30T09:43:00.000Z'), label: '30/10/2026 03:13 PM',
    needs: [2350000, 2250000, 1900000, 3500000] },
];

const rupees = (p) => '₹' + (p / 100).toLocaleString('en-IN');
const COMMIT = process.argv.includes('--commit');

// Pick the transaction that still needs this price; remove the price from it.
const allocate = (price) => {
  const t = TXNS.find((x) => x.needs.includes(price));
  if (!t) return null;
  t.needs.splice(t.needs.indexOf(price), 1);
  return t;
};

(async () => {
  await connectDB();

  const scheduled = await Auction.find({ status: AUCTION_STATUS.SCHEDULED }).lean();
  console.log(`${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${scheduled.length} SCHEDULED auction(s) to sell.\n`);

  const unmatched = [];
  for (const a of scheduled) {
    const price = a.buyNowPricePaise ?? a.startPricePaise;
    const t = allocate(price);
    if (!t) { unmatched.push(`${a.device.brand} ${a.device.model} (${rupees(price)})`); continue; }

    if (COMMIT) {
      await Auction.updateOne(
        { _id: a._id, status: AUCTION_STATUS.SCHEDULED }, // guard: only if still scheduled
        { $set: {
          status: AUCTION_STATUS.SOLD, winnerId: BUYER_ID, salePricePaise: price,
          soldAt: t.at, closedAt: t.at,
        } }
      );
      // Buy-now ⇒ source BUY_NOW, bidId/paymentId null (external bank transfer;
      // the IMPS reference lives in notes, not a Razorpay Payment row).
      const existing = await Order.findOne({ auctionId: a._id, buyerId: BUYER_ID });
      if (!existing) {
        await Order.create({
          auctionId: a._id, buyerId: BUYER_ID, sellerId: a.sellerId, sellerType: a.sellerType,
          source: ORDER_SOURCE.BUY_NOW, amountPaise: price, bidId: null, paymentId: null,
          paidAt: t.at, shippingAddress: SHIP,
          notes: [{
            text: `Paid ${rupees(price)} via IMPS ${t.txn} (ref ${t.ref}, ${t.label}, YONO SBI MANOJ JOSHI / Shakti enterprises → Redical aftermarket ltd ICICI).`,
            at: t.at,
          }],
        });
      }
    }
    console.log(`  ${a.device.brand} ${a.device.model}  →  SOLD ${rupees(price)}  via ${t.txn}`);
  }

  const leftover = TXNS.filter((t) => t.needs.length).map((t) => `${t.txn} unused ${t.needs.map(rupees).join(',')}`);
  console.log(`\nBuyer: Shakti enterprises (${BUYER_ID}) → ${SHIP.city}, ${SHIP.state} ${SHIP.pincode}`);
  if (unmatched.length) console.log(`UNMATCHED devices (no txn fits): ${unmatched.join('; ')}`);
  if (leftover.length) console.log(`UNUSED txn amounts: ${leftover.join('; ')}`);
  if (!unmatched.length && !leftover.length) console.log('All 12 devices mapped to a transaction; every receipt fully consumed.');
  console.log(COMMIT ? '\nCommitted.' : '\nDry run only — no writes. Re-run with --commit to apply.');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
