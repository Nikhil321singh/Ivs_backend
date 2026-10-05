# Bidding / Auction System — Architecture

> Status: **Implemented** · Backend only. Fits the existing
> `routes → controllers → services → providers/models` layout. Reuses the
> authentication, KYC, notification, storage, credit-pack and Razorpay systems
> that already exist — nothing here is a second copy of any of them.

## 1. What it does

A KYC-complete user lists a device for auction. Other KYC-complete users bid.
The server closes the auction at its end time, picks the highest bid, and the
winner pays through Razorpay.

### Locked decisions

| Decision | Choice |
|---|---|
| Who sells | **Both**: Grest's own stock (from the admin portal) and vendors (from the app) |
| Who can list and bid | **KYC-complete users only** (respects the `kycRequired` kill switch) |
| Cost to list | **One `AUCTION_LISTING` credit** on publish — vendors only; Grest is never charged |
| Two ways to buy | **Bid**, or **Buy Now** at an admin-set instant price that ends the auction |
| Settlement | **Razorpay after winning**, inside a **12h** window (configurable) |
| Unpaid winner | **Cascades to the next bidder** at *their own* bid, until someone pays or bidders run out |
| Late bids | **Anti-sniping on**: a bid in the last 2 minutes extends by 2 minutes |
| Fulfilment | **Grest ships everything**, however it was listed. PENDING → DISPATCHED → DELIVERED |
| Money unit | **Paise**, matching `Payment.amountPaise` |
| Timer authority | **Server only.** No client timestamp is read anywhere |

### Two things to know before launch

**Buy Now has no griefing protection.** Clicking it takes a device off the
market for the whole payment window at no cost to the clicker, and — unlike a
lapsed auction win — there are no underlying bidders to cascade to, so the
listing simply has to be relisted. This was chosen deliberately over a short
hold. `auctionBuyNowWindowHours` is a separate setting precisely so it can be
shortened if people start reserving stock they never pay for.

**Vendor payout does not exist.** On a vendor sale Grest collects the buyer's
money and owes the vendor; nothing in the system discharges that debt.
`GET /admin/orders/settlement` reports how much is owed to whom, and that is
the whole mechanism. Grest's own listings are unaffected.

---

## 2. What it reuses (and does not duplicate)

| Existing piece | How auctions use it |
|---|---|
| `middleware/auth.middleware.js` | Every endpoint. Already attaches the full user, so `kycCompleted` is free |
| `services/notification.service.js` | Outbid, won, lost, sold, takedown — via a new `AUCTION` notification type |
| `providers/s3Provider.js` | Device photos, under their own `auctionFolder` prefix |
| `DiagnoseSession` | **Referenced by id**, never copied — see §6 |
| `ImeiVerificationLog` | Referenced, and the source of the blocked/stolen publish guard |
| `entitlement.service` / `wallet.service` | The listing charge, through both billing modes |
| `providers/razorpayProvider.js` | Winner payment — same orders, same checkout config, same webhook |
| `rateLimiter.buildLimiter` | A per-user `bidLimiter` |
| `settings.service` | Every auction rule, editable from the portal without a deploy |

Two files were extended rather than copied: `upload.middleware.js` gained a
multi-file handler (it only did single/fields before), and `payment.service.js`
gained one more `purpose` branch.

---

## 3. Data model — two new collections

### `Auction`
One document covers the whole lifecycle, because the seller views the brief asks
for (Draft / Live / Ended / Sold) are states of the same thing.

```
sellerId, status   DRAFT | SCHEDULED | LIVE | ENDED_NO_BIDS
                   | PAYMENT_PENDING | SOLD | PAYMENT_EXPIRED | CANCELLED
device             { brand, model, storageGb, ramGb, color, imei }
condition          LIKE_NEW | EXCELLENT | GOOD | FAIR | POOR
photos[]           { url, publicId }        ← publicId so a photo can be deleted
diagnoseSessionId  → DiagnoseSession        (reference)
imeiVerificationId → ImeiVerificationLog    (reference)
diagnosticStatus   VERIFIED | UNVERIFIED    (denormalised, for filtering only)
imeiStatus         CLEAN | BLOCKED | STOLEN | UNKNOWN
startPricePaise, bidIncrementPaise
startAt, endAt, originalEndAt, extensionCount
currentBidPaise, currentBidderId, currentBidId, bidCount   ← cache; Bid is truth
winnerId, winningBidId, closedAt, paymentDueAt, paymentId, soldAt
listingCost, listingChargeSource, cancelledReason
```

### `Bid` — the complete history
```
auctionId, bidderId, amountPaise
status          HIGHEST | OUTBID | WON | LOST
idempotencyKey  unique sparse
ip              (kept for shill-bidding investigation)
```

Rows are immutable except `status`, which only ever moves HIGHEST → OUTBID, or
HIGHEST → WON / OUTBID → LOST at close.

### `Payment` — three additive fields
`purpose` gains `AUCTION`, plus `auctionId`. No migration: existing rows default
to `TOPUP`.

---

## 4. Simultaneous bids

The brief asked for transactions or locking. **A conditional update is the
lock**, and it is the same technique the token wallet already uses for `debit`.

Every rule that decides whether a bid wins is evaluated inside ONE
`findOneAndUpdate` against the auction document:

```js
Auction.findOneAndUpdate(
  { _id, status: 'LIVE', startAt: { $lte: now }, endAt: { $gt: now },
    currentBidderId: { $ne: bidderId },
    $expr: { $gte: [amountPaise,
      { $cond: [ { $eq: [{ $ifNull: ['$currentBidPaise', null] }, null] },
                 '$startPricePaise',
                 { $add: ['$currentBidPaise', '$bidIncrementPaise'] } ] } ] } },
  [ { $set: { currentBidPaise: amountPaise, currentBidderId: bidderId,
              bidCount: { $add: ['$bidCount', 1] },
              endAt: { $cond: [isLateBid, extendedEnd, '$endAt'] } } } ],
  { new: false }   // the PRE-update doc → who was just outbid
)
```

`$expr` reads the document's **own live values at write time**, so there is no
read-then-write gap to race through. MongoDB applies a single-document update
atomically: of two bids in the same millisecond, exactly one matches and wins.
The loser matches nothing and is told the minimum has moved.

Anti-sniping is applied in the same statement on purpose — extending in a second
write would leave a window where the sweeper could close the auction between the
bid landing and the extension applying.

**Why not `session.withTransaction`:** Atlas would allow it, but it adds nothing
to this guarantee, and the test suite's single-node in-memory Mongo cannot run
transactions at all. The `Bid` insert that follows is compensated if it fails —
the auction's cached top-of-book is restored, exactly as `wallet.service` does
when a ledger write fails.

**Duplicate bids** are keyed `auctionId:bidderId:amountPaise` (unique sparse).
This is safe *because* of the increment rule: a valid bid must always beat the
current one, so the same bidder can never legitimately bid the same amount
twice. A repeat is therefore always a double-tap or a retry, and returns the
original bid with `duplicate: true`.

---

## 5. Server time and closing

`new Date()` is compared against `endAt` **inside the database query**. No
client timestamp is read anywhere. Responses carry `serverTime` and
`secondsRemaining` so a client can run a countdown without being trusted for it.

Auctions close **two ways**, one function, every transition an atomic
conditional update:

1. **Lazily** — any read or bid on an auction past its end time closes it first.
   *This is the correctness guarantee.* With the sweeper dead, an expired
   auction still cannot accept a bid or render as live.
2. **By sweep** — a 30s pass closes auctions nobody is looking at, so winners
   are notified promptly. *This is liveness, not correctness.*

The sweep runs in-process (`server.js`); PM2 is `instances: 1`, and because
every transition is conditional it stays correct under cluster mode too.
`npm run auctions:sweep` runs the same pass from cron.

On close: highest bid → `WON`, everyone else → `LOST`, auction →
`PAYMENT_PENDING` with a `paymentDueAt`. No bids → `ENDED_NO_BIDS`. Unpaid past
the window → `PAYMENT_EXPIRED`, and the seller is free to relist.

---

## 6. The diagnostic report

A listing **references** a `DiagnoseSession` the seller already ran and paid
for. It does not embed a copy, and it does not accept an uploaded document.

Two reasons. A snapshot could show something the diagnosis no longer says. And
an uploaded PDF is unverifiable — anyone can attach a clean-looking report to a
broken phone, which would make `diagnosticStatus: VERIFIED` worthless to the
buyer bidding real money against it.

Only two derived fields are denormalised onto the auction, and only so the
browse filters can use an index instead of joining two collections on every
page: `diagnosticStatus` and `imeiStatus`.

**A device whose linked IMEI check came back BLOCKED or STOLEN cannot be
published.** We already hold CEIR's answer; listing it anyway would be knowingly
putting a stolen handset in front of buyers.

> **Open item — the diagnosis provider is a stub.** `providers/diagnoseProvider.js`
> is marked "CONTRACT TBD": it POSTs to a generic `/diagnose` and maps *any* 200
> to SUCCESS. Blancco is the intended vendor. Until that is implemented, a
> `diagnosticStatus: VERIFIED` badge is only as trustworthy as the stub, and the
> stub charges the customer for whatever comes back. See §10.

---

## 7. Listing cost

Publishing charges one `AUCTION_LISTING` credit — a new feature key alongside
`IVS_CHECK` and `DIAGNOSE`, so it flows through the existing entitlement system,
the `billingMode` switch, the pack quotas and the admin credit tools unchanged.

- Charged on **publish**, never on draft, and never again for the same listing
  however long it runs or however many bids it draws.
- Charged **last**, after every validation passes — a seller must never pay for
  a listing that was then refused. A failed charge puts the listing back in
  draft.
- Idempotent per auction (`auction-listing:<id>`), so a double-tapped publish
  cannot bill twice.

`scripts/seed-plans.js` now includes listing quotas (Basic 5 / Pro 15 / Pro Max
30). **Plans already in the database have no `AUCTION_LISTING` quota**, so their
holders cannot publish until an admin adds one via `PATCH /admin/plans/:id`.

---

## 8. API surface — 13 customer + 5 admin

| Method | Path | Notes |
|---|---|---|
| GET | `/auctions` | Live only. Filters: brand, price, condition, storage, diagnosticStatus, endingSoon, search, sort |
| POST | `/auctions` | Create a draft |
| GET | `/auctions/:id` | Full detail with the linked diagnosis and IMEI result |
| PATCH | `/auctions/:id` | Draft only — published terms are frozen |
| POST | `/auctions/:id/photos` | Multipart, field `photos` |
| DELETE | `/auctions/:id/photos/:photoId` | Also deletes the stored object |
| POST | `/auctions/:id/publish` | The billable moment |
| POST | `/auctions/:id/cancel` | Refused once bids exist |
| GET | `/auctions/:id/bids` | Public history — **first names only** |
| POST | `/auctions/:id/bids` | Place a bid |
| GET | `/auctions/my/listings` | Draft / Live / Ended / Sold |
| GET | `/auctions/my/bids` | `group=ongoing\|won\|lost`, one row per auction |
| POST | `/auctions/:id/pay` | Winner only; reuses an open order |

Admin: `GET /admin/auctions`, `/admin/auctions/stats`,
`/admin/auctions/:id`, `/admin/auctions/:id/bids` (bidders identified in full —
the view for investigating shill bidding), and
`POST /admin/auctions/:id/takedown` (works mid-auction, reason required, all
bidders notified).

**There is no auction webhook.** Winner payments run through the shared
`/wallet/topup/callback` and `/wallet/webhook/razorpay`, which dispatch on the
order's `purpose`. Nothing new needs configuring in Razorpay.

---

## 9. Deliberate guards

- A seller cannot bid on their own listing.
- A bidder cannot outbid themselves.
- Published terms cannot be edited — people bid against a price and a deadline.
- A seller cannot cancel once a bid exists; an admin can, with a recorded reason.
- Drafts are invisible to everyone but their seller (404, not 403).
- The public bid history shows first names only. A full-name history is a
  directory of who owns what and who has money to spend.
- Bidding is rate-limited per user (20/min default).

---

## 9b. Buy Now, second chances, and orders

**Buy Now** ends the auction immediately at `buyNowPricePaise`. The claim is the
same atomic conditional update bidding uses, with `$expr` comparing against the
document's own live values, so two simultaneous instant buyers cannot both win
and nobody can buy at a price bidding has already passed. Existing bidders are
marked LOST and told.

**The second-chance cascade.** When a payment window lapses, the device is
offered to the next bidder *down the book by bidder* — someone who raised their
own bid four times is one candidate, considered at their best price. Anyone
already offered and passed over is skipped, so nobody gets two bites.

The price moves with the offer: **the next bidder pays their own bid**, not the
one above them. They never agreed to that number. This is why `salePricePaise`
is a stored field rather than read from the top of the book at payment time —
`currentBidPaise` still shows the bid of someone who never paid.

**Orders** (`Order` collection) are created **before** payment, carrying the
delivery address — there is no sense taking money for something we cannot
deliver. An auction win and a Buy Now produce the same record; only `source` and
the price differ. `User.address` is deliberately not reused: it is a single
free-text KYC string with no pincode, and where someone lives is not necessarily
where they want a phone delivered.

Fulfilment transitions are checked, not free-form: DELIVERED is terminal, and an
order cannot jump from PENDING straight to DELIVERED without someone marking it
dispatched — which is exactly the gap "where is my phone" falls into.

## 9c. Grest's own listings

`Auction.sellerId` stays a required ref to a User; Grest's listings are owned by
a **system account** created on first use. Making the field nullable would have
meant touching every query, populate and index that assumes a seller exists.
`sellerType` (PLATFORM / VENDOR) is what actually distinguishes them, and it
decides two things: whether a listing credit is charged, and who Grest owes
after the sale.

Admin publish goes through `publishWithoutCharge`, which shares every
buyer-facing rule with the vendor path — photos required, duration bounds,
blocked/stolen IMEI refused — and skips only the billing.

**Relist** clones an unsold listing into a fresh draft rather than reopening it.
The finished auction keeps its own bids and defaulters as the record of what
happened; the copy starts clean, so a bidder who failed to pay may bid again.

## 10. Out of scope — read before launch

- **Vendor payout.** Buyer money lands in Grest's Razorpay account.
  `GET /admin/orders/settlement` says what is owed to each vendor; paying it is
  manual. Grest's own listings are unaffected — that money is already Grest's.
- **Disputes, refunds and returns.** No flow for "it arrived broken", and no
  refund path for a Buy Now that beat a higher bid to the click.
- **Courier integration.** Fulfilment is a status and a free-text note; there is
  no AWB, no tracking link, no carrier API.
- **Buy Now abuse controls.** No cooling-off, no strike against a buyer who
  reserves and never pays, no block on relisted stock.
- **The Blancco integration.** The diagnosis provider is a stub (§6).
- **Reserve prices** and **proxy/auto bidding.** Neither was requested.
