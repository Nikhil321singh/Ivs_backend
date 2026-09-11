const {
  app,
  request,
  createUser,
  createAuctionUser,
  createLiveAuction,
  createAdmin,
  asUser,
  creditsOf,
} = require('./helpers/factory');
const { stubCreateOrder, buildWebhook } = require('./helpers/razorpay');
const settings = require('../src/services/settings.service');
const auctionCloser = require('../src/services/auctionCloser.service');
const Auction = require('../src/models/Auction.model');
const Bid = require('../src/models/Bid.model');
const ImeiVerificationLog = require('../src/models/ImeiVerificationLog.model');
const { AUCTION_STATUS, BID_STATUS } = require('../src/constants/auctionEnums');

const asAdmin = (token) => ({
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${token}`),
  post: (path) => request(app).post(path).set('Authorization', `Bearer ${token}`),
});

const draftBody = (overrides = {}) => ({
  device: { brand: 'Apple', model: 'iPhone 13', storageGb: 128 },
  condition: 'GOOD',
  startPricePaise: 1000000,
  bidIncrementPaise: 50000,
  startAt: new Date(Date.now() + 60 * 1000).toISOString(),
  endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  ...overrides,
});

describe('listing a device', () => {
  it('refuses a seller who has not completed KYC', async () => {
    const { token } = await createAuctionUser({ kycCompleted: false });

    const res = await asUser(token).post('/api/v1/auctions').send(draftBody());

    expect(res.status).toBe(403);
  });

  it('creates a draft that is not yet visible or billable', async () => {
    const { user, token } = await createAuctionUser();

    const res = await asUser(token).post('/api/v1/auctions').send(draftBody());

    expect(res.status).toBe(201);
    expect(res.body.data.auction.status).toBe(AUCTION_STATUS.DRAFT);
    // A draft costs nothing — the charge happens on publish.
    expect(await creditsOf(user._id, 'AUCTION_LISTING')).toBe(5);

    const browse = await asUser(token).get('/api/v1/auctions');
    expect(browse.body.data.items).toHaveLength(0);
  });

  it('will not publish a listing with no photos', async () => {
    const { token } = await createAuctionUser();
    const created = await asUser(token).post('/api/v1/auctions').send(draftBody());

    const res = await asUser(token).post(
      `/api/v1/auctions/${created.body.data.auction.id}/publish`
    );

    expect(res.status).toBe(422);
  });

  it('charges one listing credit on publish', async () => {
    const { user, token } = await createAuctionUser();
    const auction = await createLiveAuction(user._id, {
      status: AUCTION_STATUS.DRAFT,
      startAt: new Date(Date.now() + 1000),
      endAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const res = await asUser(token).post(`/api/v1/auctions/${auction._id}/publish`);

    expect(res.status).toBe(200);
    expect(await creditsOf(user._id, 'AUCTION_LISTING')).toBe(4);
  });

  it('does not charge twice when publish is tapped twice', async () => {
    const { user, token } = await createAuctionUser();
    const auction = await createLiveAuction(user._id, { status: AUCTION_STATUS.DRAFT });

    await asUser(token).post(`/api/v1/auctions/${auction._id}/publish`);
    const second = await asUser(token).post(`/api/v1/auctions/${auction._id}/publish`);

    expect(second.status).toBe(409);
    expect(await creditsOf(user._id, 'AUCTION_LISTING')).toBe(4);
  });

  it('refuses to list a device CEIR reports as stolen', async () => {
    const { user, token } = await createAuctionUser();

    const check = await ImeiVerificationLog.create({
      userId: user._id,
      imei1: '355301083783251',
      imei1Status: 'STOLEN',
      allowTransaction: false,
      referenceId: 'IVS-TEST-1',
      verifiedAt: new Date(),
    });

    const auction = await createLiveAuction(user._id, {
      status: AUCTION_STATUS.DRAFT,
      imeiVerificationId: check._id,
    });

    const res = await asUser(token).post(`/api/v1/auctions/${auction._id}/publish`);

    expect(res.status).toBe(422);
    expect(res.body.errors[0].imeiStatus).toBe('STOLEN');
    // Refused before any charge.
    expect(await creditsOf(user._id, 'AUCTION_LISTING')).toBe(5);
  });

  it('will not attach a diagnosis belonging to someone else', async () => {
    const { token } = await createAuctionUser();
    const other = await createAuctionUser();
    const check = await ImeiVerificationLog.create({
      userId: other.user._id,
      imei1: '355301083783251',
      imei1Status: 'CLEAN',
      allowTransaction: true,
      referenceId: 'IVS-TEST-2',
      verifiedAt: new Date(),
    });

    const res = await asUser(token)
      .post('/api/v1/auctions')
      .send(draftBody({ imeiVerificationId: String(check._id) }));

    expect(res.status).toBe(403);
  });

  it('freezes the terms once published', async () => {
    const { user, token } = await createAuctionUser();
    const auction = await createLiveAuction(user._id);

    const res = await asUser(token)
      .patch(`/api/v1/auctions/${auction._id}`)
      .send({ startPricePaise: 1 });

    expect(res.status).toBe(409);
  });
});

describe('placing a bid', () => {
  it('accepts a first bid at the start price and reports the next minimum', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    const res = await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    expect(res.status).toBe(201);
    expect(res.body.data.bid.status).toBe(BID_STATUS.HIGHEST);
    expect(res.body.data.auction.currentBidPaise).toBe(1000000);
    expect(res.body.data.auction.minNextBidPaise).toBe(1050000);
    expect(res.body.data.auction.bidCount).toBe(1);
  });

  it('refuses a bid below the start price', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    const res = await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 999999 });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].minNextBidPaise).toBe(1000000);
  });

  it('refuses a bid that does not clear the increment', async () => {
    const seller = await createAuctionUser();
    const a = await createAuctionUser();
    const b = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    await asUser(a.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    const res = await asUser(b.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1049999 });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].minNextBidPaise).toBe(1050000);
  });

  it('marks the beaten bid OUTBID', async () => {
    const seller = await createAuctionUser();
    const a = await createAuctionUser();
    const b = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    const first = await asUser(a.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });
    await asUser(b.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1050000 });

    const beaten = await Bid.findById(first.body.data.bid.id);
    expect(beaten.status).toBe(BID_STATUS.OUTBID);
  });

  it('stops a seller bidding on their own listing', async () => {
    const seller = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    const res = await asUser(seller.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    expect(res.status).toBe(403);
  });

  it('stops a bidder outbidding themselves', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    const res = await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1050000 });

    expect(res.status).toBe(409);
  });

  it('treats a repeated bid as the same bid, not a second one', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    const first = await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });
    const retry = await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    expect(retry.status).toBe(201);
    expect(retry.body.data.duplicate).toBe(true);
    expect(retry.body.data.bid.id).toBe(first.body.data.bid.id);
    expect(await Bid.countDocuments({ auctionId: auction._id })).toBe(1);
  });

  it('lets exactly one of two simultaneous bids become the highest', async () => {
    const seller = await createAuctionUser();
    const a = await createAuctionUser();
    const b = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    const [one, two] = await Promise.all([
      asUser(a.token).post(`/api/v1/auctions/${auction._id}/bids`).send({ amountPaise: 1000000 }),
      asUser(b.token).post(`/api/v1/auctions/${auction._id}/bids`).send({ amountPaise: 1000000 }),
    ]);

    // Same amount from two people: the first to land takes it, the other is
    // told the minimum has moved. Both can never win.
    expect([one.status, two.status].sort()).toEqual([201, 409]);

    const fresh = await Auction.findById(auction._id);
    expect(fresh.bidCount).toBe(1);
    expect(fresh.currentBidPaise).toBe(1000000);
    expect(await Bid.countDocuments({ auctionId: auction._id, status: BID_STATUS.HIGHEST })).toBe(1);
  });

  it('refuses a bid on an auction whose time has run out, without waiting for the sweeper', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id, {
      startAt: new Date(Date.now() - 60 * 60 * 1000),
      endAt: new Date(Date.now() - 1000),
    });

    const res = await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    expect(res.status).toBe(409);
    // Reading it was enough to close it — the end time is enforced per request.
    const fresh = await Auction.findById(auction._id);
    expect(fresh.status).toBe(AUCTION_STATUS.ENDED_NO_BIDS);
  });
});

describe('anti-sniping', () => {
  it('pushes the end time out when a bid lands in the closing window', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const endAt = new Date(Date.now() + 30 * 1000); // inside the 120s window
    const auction = await createLiveAuction(seller.user._id, { endAt, originalEndAt: endAt });

    const res = await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    expect(res.status).toBe(201);
    expect(res.body.data.extended).toBe(true);

    const fresh = await Auction.findById(auction._id);
    expect(fresh.endAt.getTime()).toBeGreaterThan(endAt.getTime());
    expect(fresh.extensionCount).toBe(1);
    // The original is kept, so "why did this run long" stays answerable.
    expect(fresh.originalEndAt.getTime()).toBe(endAt.getTime());
  });

  it('leaves the end time alone for a bid placed well before the close', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);
    const endAt = auction.endAt.getTime();

    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    const fresh = await Auction.findById(auction._id);
    expect(fresh.endAt.getTime()).toBe(endAt);
    expect(fresh.extensionCount).toBe(0);
  });

  it('can be switched off by the operator', async () => {
    await settings.update({ auctionAntiSnipeEnabled: false });
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const endAt = new Date(Date.now() + 30 * 1000);
    const auction = await createLiveAuction(seller.user._id, { endAt });

    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    const fresh = await Auction.findById(auction._id);
    expect(fresh.endAt.getTime()).toBe(endAt.getTime());
  });
});

describe('closing an auction', () => {
  it('picks the highest bid, marks the winner WON and everyone else LOST', async () => {
    const seller = await createAuctionUser();
    const a = await createAuctionUser();
    const b = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    await asUser(a.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });
    const winning = await asUser(b.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1050000 });

    await Auction.updateOne({ _id: auction._id }, { endAt: new Date(Date.now() - 1000) });
    await auctionCloser.closeAuction(auction._id);

    const closed = await Auction.findById(auction._id);
    expect(closed.status).toBe(AUCTION_STATUS.PAYMENT_PENDING);
    expect(String(closed.winnerId)).toBe(String(b.user._id));
    expect(closed.paymentDueAt).toBeTruthy();

    expect((await Bid.findById(winning.body.data.bid.id)).status).toBe(BID_STATUS.WON);
    expect(await Bid.countDocuments({ auctionId: auction._id, status: BID_STATUS.LOST })).toBe(1);
  });

  it('ends with no winner when nobody bid', async () => {
    const seller = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id, {
      endAt: new Date(Date.now() - 1000),
    });

    await auctionCloser.closeAuction(auction._id);

    const closed = await Auction.findById(auction._id);
    expect(closed.status).toBe(AUCTION_STATUS.ENDED_NO_BIDS);
    expect(closed.winnerId).toBeNull();
  });

  it('is idempotent — closing twice does not re-settle', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });
    await Auction.updateOne({ _id: auction._id }, { endAt: new Date(Date.now() - 1000) });

    const first = await auctionCloser.closeAuction(auction._id);
    const second = await auctionCloser.closeAuction(auction._id);

    expect(first.status).toBe(AUCTION_STATUS.PAYMENT_PENDING);
    expect(second.status).toBe(AUCTION_STATUS.PAYMENT_PENDING);
    expect(String(second.closedAt)).toBe(String(first.closedAt));
  });

  it('will not close an auction a late bid has just extended', async () => {
    const seller = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id, {
      endAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await auctionCloser.closeAuction(auction._id);

    expect((await Auction.findById(auction._id)).status).toBe(AUCTION_STATUS.LIVE);
  });

  it('activates scheduled auctions whose start time has arrived', async () => {
    const seller = await createAuctionUser();
    await createLiveAuction(seller.user._id, {
      status: AUCTION_STATUS.SCHEDULED,
      startAt: new Date(Date.now() - 1000),
    });

    const activated = await auctionCloser.activateDue();

    expect(activated).toBe(1);
  });
});

describe('browsing and my views', () => {
  it('lists only live auctions and carries server time', async () => {
    const seller = await createAuctionUser();
    const viewer = await createAuctionUser();
    await createLiveAuction(seller.user._id);
    await createLiveAuction(seller.user._id, { status: AUCTION_STATUS.DRAFT });
    await createLiveAuction(seller.user._id, { endAt: new Date(Date.now() - 1000) });

    const res = await asUser(viewer.token).get('/api/v1/auctions');

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.serverTime).toBeTruthy();
    expect(res.body.data.items[0].secondsRemaining).toBeGreaterThan(0);
  });

  it('filters by brand and by ending soon', async () => {
    const seller = await createAuctionUser();
    const viewer = await createAuctionUser();
    await createLiveAuction(seller.user._id, { device: { brand: 'Apple', model: 'iPhone 13' } });
    await createLiveAuction(seller.user._id, { device: { brand: 'Samsung', model: 'S21' } });
    await createLiveAuction(seller.user._id, {
      device: { brand: 'Apple', model: 'iPhone 12' },
      endAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    const byBrand = await asUser(viewer.token).get('/api/v1/auctions?brand=apple');
    expect(byBrand.body.data.items).toHaveLength(2);

    const soon = await asUser(viewer.token).get('/api/v1/auctions?endingSoonMinutes=30');
    expect(soon.body.data.items).toHaveLength(1);
    expect(soon.body.data.items[0].device.model).toBe('iPhone 12');
  });

  it('groups my bids by auction and splits ongoing from won and lost', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const other = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    // Same bidder raising twice on one auction should be one row, not two.
    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });
    await asUser(other.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1050000 });
    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1100000 });

    const ongoing = await asUser(bidder.token).get('/api/v1/auctions/my/bids?group=ongoing');

    expect(ongoing.body.data.items).toHaveLength(1);
    expect(ongoing.body.data.items[0].myBidPaise).toBe(1100000);
    expect(ongoing.body.data.items[0].status).toBe(BID_STATUS.HIGHEST);

    await Auction.updateOne({ _id: auction._id }, { endAt: new Date(Date.now() - 1000) });
    await auctionCloser.closeAuction(auction._id);

    const won = await asUser(bidder.token).get('/api/v1/auctions/my/bids?group=won');
    const lost = await asUser(other.token).get('/api/v1/auctions/my/bids?group=lost');

    expect(won.body.data.items).toHaveLength(1);
    expect(lost.body.data.items).toHaveLength(1);
  });

  it('shows the seller their own listings by status', async () => {
    const seller = await createAuctionUser();
    await createLiveAuction(seller.user._id);
    await createLiveAuction(seller.user._id, { status: AUCTION_STATUS.DRAFT });

    const drafts = await asUser(seller.token).get('/api/v1/auctions/my/listings?status=DRAFT');

    expect(drafts.body.data.items).toHaveLength(1);
    expect(drafts.body.data.items[0].status).toBe(AUCTION_STATUS.DRAFT);
  });

  it('keeps a draft private from everyone but its seller', async () => {
    const seller = await createAuctionUser();
    const stranger = await createAuctionUser();
    const draft = await createLiveAuction(seller.user._id, { status: AUCTION_STATUS.DRAFT });

    const res = await asUser(stranger.token).get(`/api/v1/auctions/${draft._id}`);

    expect(res.status).toBe(404);
  });

  it('shows bidders by first name only', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser({ name: 'Priya Sharma' });
    const auction = await createLiveAuction(seller.user._id);

    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    const res = await asUser(seller.token).get(`/api/v1/auctions/${auction._id}/bids`);

    expect(res.body.data.items[0].bidder).toBe('Priya');
  });
});

describe('the winner paying', () => {
  const closeWithWinner = async () => {
    const seller = await createAuctionUser();
    const winner = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    await asUser(winner.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });
    await Auction.updateOne({ _id: auction._id }, { endAt: new Date(Date.now() - 1000) });
    await auctionCloser.closeAuction(auction._id);

    return { seller, winner, auction };
  };

  it('creates an order for the winning amount and marks the auction SOLD on capture', async () => {
    const { winner, auction } = await closeWithWinner();
    stubCreateOrder('order_auction_1');

    const order = await asUser(winner.token).post(`/api/v1/auctions/${auction._id}/pay`);

    expect(order.status).toBe(201);
    expect(order.body.data.amount).toBe(1000000);

    const { body, signature } = buildWebhook('payment.captured', 'order_auction_1', 'pay_auc_1');
    await request(app)
      .post('/api/v1/wallet/webhook/razorpay')
      .set('x-razorpay-signature', signature)
      .set('Content-Type', 'application/json')
      .send(body);

    const sold = await Auction.findById(auction._id);
    expect(sold.status).toBe(AUCTION_STATUS.SOLD);
    expect(sold.soldAt).toBeTruthy();
  });

  it('credits nothing to the payer — this is a sale, not a purchase from us', async () => {
    const { winner, auction } = await closeWithWinner();
    stubCreateOrder('order_auction_2');
    await asUser(winner.token).post(`/api/v1/auctions/${auction._id}/pay`);

    const { body, signature } = buildWebhook('payment.captured', 'order_auction_2', 'pay_auc_2');
    await request(app)
      .post('/api/v1/wallet/webhook/razorpay')
      .set('x-razorpay-signature', signature)
      .set('Content-Type', 'application/json')
      .send(body);

    const wallet = await asUser(winner.token).get('/api/v1/wallet');
    expect(wallet.body.data.wallet.balance).toBe(0);
  });

  it('refuses anyone who is not the winning bidder', async () => {
    const { auction } = await closeWithWinner();
    const stranger = await createAuctionUser();

    const res = await asUser(stranger.token).post(`/api/v1/auctions/${auction._id}/pay`);

    expect(res.status).toBe(403);
  });

  it('reuses an order the winner already has open', async () => {
    const { winner, auction } = await closeWithWinner();
    stubCreateOrder('order_auction_3');

    const first = await asUser(winner.token).post(`/api/v1/auctions/${auction._id}/pay`);
    const second = await asUser(winner.token).post(`/api/v1/auctions/${auction._id}/pay`);

    expect(second.body.data.orderId).toBe(first.body.data.orderId);
    expect(second.body.data.reused).toBe(true);
  });

  it('lapses the sale when the payment window passes', async () => {
    const { auction } = await closeWithWinner();
    await Auction.updateOne({ _id: auction._id }, { paymentDueAt: new Date(Date.now() - 1000) });

    const expired = await auctionCloser.expireUnpaid();

    expect(expired).toBe(1);
    expect((await Auction.findById(auction._id)).status).toBe(AUCTION_STATUS.PAYMENT_EXPIRED);
  });
});

describe('cancelling and moderation', () => {
  it('lets a seller cancel a listing nobody has bid on', async () => {
    const seller = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    const res = await asUser(seller.token).post(`/api/v1/auctions/${auction._id}/cancel`);

    expect(res.status).toBe(200);
    expect(res.body.data.auction.status).toBe(AUCTION_STATUS.CANCELLED);
  });

  it('stops a seller pulling a listing out from under live bidders', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    const res = await asUser(seller.token).post(`/api/v1/auctions/${auction._id}/cancel`);

    expect(res.status).toBe(409);
  });

  it('lets an admin take down a listing that does have bids', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);
    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    const { token } = await createAdmin();
    const res = await asAdmin(token)
      .post(`/api/v1/admin/auctions/${auction._id}/takedown`)
      .send({ reason: 'IMEI reported stolen by CEIR' });

    expect(res.status).toBe(200);
    const fresh = await Auction.findById(auction._id);
    expect(fresh.status).toBe(AUCTION_STATUS.CANCELLED);
    expect(fresh.cancelledReason).toBe('IMEI reported stolen by CEIR');
  });

  it('requires a reason for a takedown', async () => {
    const seller = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);
    const { token } = await createAdmin();

    const res = await asAdmin(token)
      .post(`/api/v1/admin/auctions/${auction._id}/takedown`)
      .send({});

    expect(res.status).toBe(422);
  });

  it('shows an admin every bidder in full, unlike the public history', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser({ name: 'Priya Sharma' });
    const auction = await createLiveAuction(seller.user._id);
    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    const { token } = await createAdmin();
    const res = await asAdmin(token).get(`/api/v1/admin/auctions/${auction._id}/bids`);

    expect(res.status).toBe(200);
    expect(res.body.data.items[0].bidderId.name).toBe('Priya Sharma');
    expect(res.body.data.items[0].bidderId.mobile).toBeTruthy();
  });
});

describe('unauthenticated access', () => {
  it('requires a token to browse', async () => {
    const res = await request(app).get('/api/v1/auctions');
    expect(res.status).toBe(401);
  });

  it('requires a token to bid', async () => {
    const seller = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    const res = await request(app)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    expect(res.status).toBe(401);
  });

  it('does not let a signed-in user without KYC bid', async () => {
    const seller = await createAuctionUser();
    const { token } = await createUser();
    const auction = await createLiveAuction(seller.user._id);

    const res = await asUser(token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });

    expect(res.status).toBe(403);
  });
});
