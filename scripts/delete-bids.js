/**
 * Deletes specific bid-history rows and repairs the parent auction's
 * denormalised state (currentBidPaise / currentBidderId / bidCount) and the
 * HIGHEST flag, so the "Bid history" panel and the auction card stay consistent.
 *
 * Bids are append-only (see Bid.model.js), so there is no delete path in the
 * app — this is a QA/admin cleanup tool. It is DRY-RUN by default; pass --apply
 * to actually write.
 *
 *   # 1) Find the bids you want to remove (prints each bid's _id):
 *   node scripts/delete-bids.js --auction 6710ab...   # list a single auction
 *   node scripts/delete-bids.js --mobile 8010253195   # list a bidder's bids
 *
 *   # 2) Delete them by _id (repeatable), dry-run first, then --apply:
 *   node scripts/delete-bids.js --bid 671f... --bid 671f...
 *   node scripts/delete-bids.js --bid 671f... --bid 671f... --apply
 *
 *   # ...or match by <mobile>:<amountInINR> (repeatable). Each match must
 *   # resolve to exactly ONE bid or the run aborts (so it never deletes the
 *   # wrong auction's identically-priced bid):
 *   node scripts/delete-bids.js --match 8010253195:15500 --match 9140337564:15250
 *   node scripts/delete-bids.js --match 8010253195:15500 --match 9140337564:15250 --apply
 *
 * After deleting, for each affected auction that is still LIVE it recomputes the
 * top of the book from the surviving bids and flips the new top bid to HIGHEST.
 * For closed auctions it refreshes currentBid/bidCount but will NOT re-derive a
 * winner (WON/LOST) — it warns instead, since that needs the real close logic.
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User.model');
const Auction = require('../src/models/Auction.model');
const Bid = require('../src/models/Bid.model');
const { AUCTION_STATUS, BID_STATUS } = require('../src/constants/auctionEnums');

const args = (name) => {
  const out = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}`) out.push(process.argv[i + 1]);
  });
  return out;
};
const arg = (name) => args(name)[0];
const has = (name) => process.argv.includes(`--${name}`);

const APPLY = has('apply');
const BID_IDS = args('bid');
const MATCHES = args('match'); // ["8010253195:15500", ...]
const AUCTION_ID = arg('auction');
const MOBILE = arg('mobile');

const inr = (paise) => (paise == null ? '—' : `₹${(paise / 100).toLocaleString('en-IN')}`);

async function bidderLabel(bid) {
  const u = await User.findById(bid.bidderId, 'name mobile').lean();
  const name = u?.name || '(unknown)';
  return `${name} ${u?.mobile || ''}`.trim();
}

async function listBids(filter) {
  const bids = await Bid.find(filter).sort({ auctionId: 1, amountPaise: -1 }).lean();
  if (!bids.length) {
    console.log('No bids matched.');
    return;
  }
  console.log(`\n${bids.length} bid(s):\n`);
  for (const b of bids) {
    const who = await bidderLabel(b);
    console.log(
      `  _id=${b._id}  auction=${b.auctionId}  ${inr(b.amountPaise).padStart(10)}  ` +
      `${(b.status || '').padEnd(7)}  ${who}  ${new Date(b.createdAt).toISOString()}`
    );
  }
  console.log('\nDelete with: node scripts/delete-bids.js --bid <_id> [--bid <_id> ...] --apply\n');
}

// Recompute an auction's denormalised top-of-book from its surviving bids.
// `deletedIds` are the bids being removed this run — excluded from "remaining"
// so the dry-run preview reflects the post-delete state, not the current one.
async function repairAuction(auctionId, deletedIds = []) {
  const auction = await Auction.findById(auctionId);
  if (!auction) {
    console.log(`  auction ${auctionId} no longer exists — skipping repair`);
    return;
  }

  const remaining = (await Bid.find({ auctionId }).sort({ amountPaise: -1, createdAt: 1 }))
    .filter((b) => !deletedIds.includes(String(b._id)));
  const top = remaining[0] || null;

  const before = `currentBid=${inr(auction.currentBidPaise)} bidder=${auction.currentBidderId || '—'} bidCount=${auction.bidCount}`;

  auction.currentBidPaise = top ? top.amountPaise : null;
  auction.currentBidderId = top ? top.bidderId : null;
  // currentBidId MUST move too: the auction closer reads it as the winning bid,
  // so leaving it pointing at a deleted bid makes the close award a ghost winner.
  auction.currentBidId = top ? top._id : null;
  auction.bidCount = remaining.length;

  const isLive = auction.status === AUCTION_STATUS.LIVE;

  if (isLive) {
    // Re-flip the book: new top is HIGHEST, everyone else OUTBID.
    for (const b of remaining) {
      const next = b === top ? BID_STATUS.HIGHEST : BID_STATUS.OUTBID;
      if (b.status !== next) {
        b.status = next;
        if (APPLY) await b.save();
      }
    }
  } else {
    const hadWinnerBid = await Bid.exists({
      auctionId,
      status: { $in: [BID_STATUS.WON, BID_STATUS.HIGHEST] },
    });
    if (!hadWinnerBid) {
      console.log(
        `  ⚠️  auction ${auctionId} is ${auction.status} and its winning bid was deleted — ` +
        `winner NOT re-derived. Re-run the close logic or fix winnerId/status manually.`
      );
    }
  }

  const after = `currentBid=${inr(auction.currentBidPaise)} bidder=${auction.currentBidderId || '—'} bidCount=${auction.bidCount}`;
  console.log(`  auction ${auctionId}: ${before}  ->  ${after}${isLive ? ' (top re-flipped HIGHEST)' : ''}`);

  if (APPLY) await auction.save();
}

const run = async () => {
  await mongoose.connect(env.mongodbUri);

  // --- Resolve --match <mobile>:<amountInr> into exact bid ids -----------
  // Each match must hit exactly one bid, or we abort rather than guess which
  // auction's identically-priced bid to delete.
  const matchedIds = [];
  if (MATCHES.length) {
    let ambiguous = false;
    for (const m of MATCHES) {
      const [mobile, amountStr] = String(m).split(':');
      const amountInr = Number(amountStr);
      if (!mobile || !Number.isFinite(amountInr)) {
        throw new Error(`Bad --match "${m}" — expected <mobile>:<amountInINR>, e.g. 8010253195:15500`);
      }
      const user = await User.findOne({ mobile }, '_id name');
      if (!user) throw new Error(`No user with mobile ${mobile} (--match ${m})`);

      const found = await Bid.find({ bidderId: user._id, amountPaise: amountInr * 100 }).lean();
      if (found.length === 0) {
        throw new Error(`No bid of ₹${amountInr} by ${user.name || mobile} (--match ${m})`);
      }
      if (found.length > 1) {
        ambiguous = true;
        console.log(`\n✋ --match ${m} is ambiguous — ${found.length} bids of ₹${amountInr} by ${user.name || mobile}:`);
        for (const b of found) {
          console.log(`     _id=${b._id}  auction=${b.auctionId}  ${b.status}  ${new Date(b.createdAt).toISOString()}`);
        }
        console.log('   Pick the exact one with --bid <_id> instead.');
        continue;
      }
      matchedIds.push(String(found[0]._id));
    }
    if (ambiguous) throw new Error('Aborted: one or more --match values were ambiguous (see above).');
    BID_IDS.push(...matchedIds);
  }

  // --- List modes (no --bid / --match): just show candidates and exit -----
  if (!BID_IDS.length) {
    if (AUCTION_ID) {
      await listBids({ auctionId: AUCTION_ID });
    } else if (MOBILE) {
      const u = await User.findOne({ mobile: MOBILE }, '_id');
      if (!u) throw new Error(`No user with mobile ${MOBILE}`);
      await listBids({ bidderId: u._id });
    } else {
      throw new Error(
        'Nothing to do. List with --auction <id> or --mobile <m>, ' +
        'or delete with --bid <_id> [--bid ...] [--apply].'
      );
    }
    await mongoose.disconnect();
    return;
  }

  // --- Delete mode --------------------------------------------------------
  const bids = await Bid.find({ _id: { $in: BID_IDS } });
  const foundIds = bids.map((b) => String(b._id));
  const missing = BID_IDS.filter((id) => !foundIds.includes(String(id)));
  if (missing.length) console.log(`⚠️  Not found (ignored): ${missing.join(', ')}`);
  if (!bids.length) throw new Error('None of the given --bid ids exist.');

  console.log(`\n${APPLY ? 'DELETING' : 'DRY RUN — would delete'} ${bids.length} bid(s):\n`);
  for (const b of bids) {
    console.log(`  _id=${b._id}  auction=${b.auctionId}  ${inr(b.amountPaise)}  ${b.status}  ${await bidderLabel(b)}`);
  }

  const affectedAuctions = [...new Set(bids.map((b) => String(b.auctionId)))];

  if (APPLY) {
    const res = await Bid.deleteMany({ _id: { $in: bids.map((b) => b._id) } });
    console.log(`\nDeleted ${res.deletedCount} bid(s).`);
  }

  const deletedIds = bids.map((b) => String(b._id));
  console.log(`\nRepairing ${affectedAuctions.length} auction(s):`);
  for (const id of affectedAuctions) await repairAuction(id, deletedIds);

  console.log(APPLY ? '\n✅ Done.' : '\n(dry run — re-run with --apply to write)');
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
