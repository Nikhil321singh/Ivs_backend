/**
 * Re-opens PAYMENT_EXPIRED auctions for payment with a fresh window, offering
 * the device back to the TOP bidder (the highest bid at close). Written as a
 * one-off after the payment window was raised 12h -> 24h: auctions that expired
 * under the old 12h rule should get the longer window their winners would have
 * had under the new policy.
 *
 *   # DRY RUN (default) — prints exactly what it would change, writes nothing:
 *   node scripts/revive-expired-auctions.js
 *
 *   # Execute:
 *   node scripts/revive-expired-auctions.js --confirm
 *
 *   # Options:
 *   --id <id> [--id <id> ...]   auctions to revive (default: the two below)
 *   --hours <n>                 payment window length (default: 24)
 *
 * Needs MONGODB_URI in the environment (the same .env this backend uses), and
 * must point at the SAME database the auction service uses.
 *
 * What it does, per auction (only if it is still PAYMENT_EXPIRED — idempotent,
 * re-running is a no-op once revived):
 *   auctions:  status      PAYMENT_EXPIRED -> PAYMENT_PENDING
 *              winnerId     <- currentBidderId   (the top bidder)
 *              winningBidId <- currentBidId       (the top bid)
 *              salePricePaise <- top bid's amountPaise
 *              paymentDueAt <- now + <hours>
 *              passedBidderIds -> []              (undo every pass)
 *   bids:      the top bid   -> WON   (from EXPIRED)
 *              any other bid on the auction that is WON/EXPIRED -> LOST
 *
 * These field transitions were derived from a live healthy PAYMENT_PENDING
 * auction, NOT from the auction service source (which was not available). So:
 *
 *   !!  CAVEAT 1 — NOTIFICATION / PAYMENT LINK. This only fixes the database.
 *       It does NOT re-notify the winner or (re)generate a Razorpay payment
 *       link. Confirm the buyer app surfaces a pay action for a PAYMENT_PENDING
 *       auction with a future paymentDueAt. If it needs a push/SMS or a
 *       pre-created order, that must be triggered separately in the service.
 *
 *   !!  CAVEAT 2 — EXPIRY CRON. A future paymentDueAt should keep the expiry
 *       job from re-killing these, but that job lives in the auction service.
 *       Verify it expires on `now > paymentDueAt` and not on some other flag.
 *
 *   !!  CAVEAT 3 — WINDOW MUST BE LIVE. As of writing, auctions were still
 *       closing with 12h windows despite the 24h setting — i.e. the service was
 *       not applying the new value. If that is still true, reviving here is
 *       cosmetic: fix the service first (restart / wire the setting), then run.
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const argAll = (name) =>
  process.argv.reduce((acc, v, i) => (v === `--${name}` ? [...acc, process.argv[i + 1]] : acc), []);

const CONFIRM = process.argv.includes('--confirm');
const HOURS = parseInt(arg('hours') || '24', 10);

// Which statuses we will re-point to the top bidder. PAYMENT_EXPIRED = fully
// dead, re-open it. PAYMENT_PENDING = a roll-down handed the offer to a lower
// bidder; --repoint-pending reassigns it back to the top bidder (this REVOKES
// the current holder's live window — see the table printed per auction).
const REPOINT_PENDING = process.argv.includes('--repoint-pending');
// Inverse of a revive: end an auction's payment window with no sale, mirroring
// a natural expiry (winner/winningBid cleared, top bid EXPIRED, bidder parked
// in passedBidderIds, paymentDueAt cleared). No money or order is touched.
const FORCE_EXPIRE = process.argv.includes('--force-expire');
const ALLOWED =
  FORCE_EXPIRE || REPOINT_PENDING ? ['PAYMENT_EXPIRED', 'PAYMENT_PENDING'] : ['PAYMENT_EXPIRED'];

// The two auctions that expired on 12-13 Oct under the old 12h window. Both are
// single-bidder, so "top bidder" is unambiguous. Override with --id to target
// others, but review multi-bidder cases first (see the LOST reset below).
const DEFAULT_IDS = ['6accb5e128faf8a1ca521f4c', '6acc99bc28faf8a1ca520bf9'];
const IDS = argAll('id').length ? argAll('id') : DEFAULT_IDS;

const oid = (id) => new mongoose.Types.ObjectId(id);

const run = async () => {
  if (!env.mongodbUri) throw new Error('MONGODB_URI is not set.');
  await mongoose.connect(env.mongodbUri);
  const db = mongoose.connection;
  const now = new Date();
  const due = new Date(now.getTime() + HOURS * 60 * 60 * 1000);

  /* eslint-disable no-console */
  console.log(`\n${CONFIRM ? 'EXECUTING' : 'DRY RUN (no writes)'} — window ${HOURS}h, due ${due.toISOString()}`);
  console.log(`DB: ${db.host}\n`);

  for (const id of IDS) {
    const auction = await db.collection('auctions').findOne({ _id: oid(id) });

    if (!auction) {
      console.log(`- ${id}: NOT FOUND, skipping`);
      continue;
    }
    if (!ALLOWED.includes(auction.status)) {
      console.log(`- ${id}: status is ${auction.status} (not in ${ALLOWED.join('/')}), skipping`);
      continue;
    }
    if (!auction.currentBidId || !auction.currentBidderId) {
      console.log(`- ${id}: no currentBidId/currentBidderId (no bids to offer), skipping`);
      continue;
    }
    // ---- Force-expire: end the window, no sale. ----
    if (FORCE_EXPIRE) {
      if (auction.status === 'PAYMENT_EXPIRED') {
        console.log(`- ${id}: already PAYMENT_EXPIRED, skipping`);
        continue;
      }
      console.log(`- ${id}: ${auction.device?.brand} ${auction.device?.model}`);
      console.log(`    status ${auction.status} -> PAYMENT_EXPIRED; winner/winningBid -> null; paymentDueAt -> null`);
      console.log(`    top bid ${auction.currentBidId} -> EXPIRED; park ${auction.currentBidderId} in passedBidderIds`);
      if (!CONFIRM) {
        console.log('    (dry run — not written)');
        continue;
      }
      const r = await db.collection('auctions').updateOne(
        { _id: auction._id, status: { $in: ALLOWED } },
        {
          $set: { status: 'PAYMENT_EXPIRED', winnerId: null, winningBidId: null, paymentDueAt: null, updatedAt: now },
          $addToSet: { passedBidderIds: auction.currentBidderId },
        }
      );
      if (r.modifiedCount === 1) {
        await db.collection('bids').updateOne(
          { _id: auction.currentBidId },
          { $set: { status: 'EXPIRED', updatedAt: now } }
        );
        console.log('    DONE: force-expired.');
      } else {
        console.log(`    not modified (modifiedCount=${r.modifiedCount}) — raced; skipping`);
      }
      continue;
    }

    // Idempotent: already points at the top bidder with no outstanding passes.
    const winnerId = auction.winnerId && (auction.winnerId._id || auction.winnerId);
    if (
      auction.status === 'PAYMENT_PENDING' &&
      String(winnerId) === String(auction.currentBidderId) &&
      String(auction.winningBidId) === String(auction.currentBidId) &&
      (auction.passedBidderIds || []).length === 0
    ) {
      console.log(`- ${id}: already offered to the top bidder, skipping`);
      continue;
    }

    const topBid = await db.collection('bids').findOne({ _id: auction.currentBidId });
    const salePricePaise = topBid ? topBid.amountPaise : auction.currentBidPaise;

    // How many bids on this auction are NOT the top bid — for multi-bidder
    // auctions those will be reset to LOST. Surfaced so you can eyeball it.
    const otherBids = await db
      .collection('bids')
      .countDocuments({ auctionId: auction._id, _id: { $ne: auction.currentBidId } });

    console.log(`- ${id}: ${auction.device?.brand} ${auction.device?.model}`);
    console.log(`    winner <- ${auction.currentBidderId}  (top bid ${auction.currentBidId})`);
    console.log(`    salePricePaise <- ${salePricePaise}   passedBidderIds [${(auction.passedBidderIds || []).join(', ')}] -> []`);
    console.log(`    top bid status ${topBid ? topBid.status : '?'} -> WON;  ${otherBids} other bid(s) -> LOST`);

    if (!CONFIRM) {
      console.log('    (dry run — not written)');
      continue;
    }

    const res = await db.collection('auctions').updateOne(
      { _id: auction._id, status: { $in: ALLOWED } }, // re-check status: idempotent under races
      {
        $set: {
          status: 'PAYMENT_PENDING',
          winnerId: auction.currentBidderId,
          winningBidId: auction.currentBidId,
          salePricePaise,
          paymentDueAt: due,
          updatedAt: now,
          passedBidderIds: [],
        },
      }
    );

    if (res.modifiedCount !== 1) {
      console.log(`    auction not modified (modifiedCount=${res.modifiedCount}) — raced or already revived; skipping bids`);
      continue;
    }

    await db.collection('bids').updateOne(
      { _id: auction.currentBidId },
      { $set: { status: 'WON', updatedAt: now } }
    );
    const lost = await db.collection('bids').updateMany(
      { auctionId: auction._id, _id: { $ne: auction.currentBidId }, status: { $in: ['WON', 'EXPIRED'] } },
      { $set: { status: 'LOST', updatedAt: now } }
    );

    console.log(`    DONE: revived to PAYMENT_PENDING; top bid WON; ${lost.modifiedCount} bid(s) set LOST`);
  }

  await mongoose.disconnect();
  console.log(`\n${CONFIRM ? 'Done.' : 'Dry run complete. Re-run with --confirm to apply.'}\n`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
