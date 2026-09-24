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
  patch: (path) => request(app).patch(path).set('Authorization', `Bearer ${token}`),
});

// A valid delivery address. Required before any payment — an order with
// nowhere to send the device cannot be dispatched.
const ADDRESS = {
  name: 'Priya Sharma',
  phone: '9876543210',
  line1: '12 MG Road',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
};

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

    const order = await asUser(winner.token).post(`/api/v1/auctions/${auction._id}/pay`).send({ shippingAddress: ADDRESS });

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
    await asUser(winner.token).post(`/api/v1/auctions/${auction._id}/pay`).send({ shippingAddress: ADDRESS });

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

    const res = await asUser(stranger.token).post(`/api/v1/auctions/${auction._id}/pay`).send({ shippingAddress: ADDRESS });

    expect(res.status).toBe(403);
  });

  it('reuses an order the winner already has open', async () => {
    const { winner, auction } = await closeWithWinner();
    stubCreateOrder('order_auction_3');

    const first = await asUser(winner.token).post(`/api/v1/auctions/${auction._id}/pay`).send({ shippingAddress: ADDRESS });
    const second = await asUser(winner.token).post(`/api/v1/auctions/${auction._id}/pay`).send({ shippingAddress: ADDRESS });

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

describe('second chance when the winner does not pay', () => {
  const closeWithTwoBidders = async () => {
    const seller = await createAuctionUser();
    const top = await createAuctionUser();
    const second = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);

    await asUser(second.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });
    await asUser(top.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1050000 });

    await Auction.updateOne({ _id: auction._id }, { endAt: new Date(Date.now() - 1000) });
    await auctionCloser.closeAuction(auction._id);
    await Auction.updateOne({ _id: auction._id }, { paymentDueAt: new Date(Date.now() - 1000) });

    return { seller, top, second, auction };
  };

  it('offers the device to the next bidder at THEIR bid, not the top bid', async () => {
    const { top, second, auction } = await closeWithTwoBidders();

    await auctionCloser.expireUnpaid();

    const fresh = await Auction.findById(auction._id);
    expect(fresh.status).toBe(AUCTION_STATUS.PAYMENT_PENDING);
    expect(String(fresh.winnerId)).toBe(String(second.user._id));
    // The crux: the second bidder pays what they bid, not what the defaulter
    // bid. Charging them 1050000 would bill them for someone else's bid.
    expect(fresh.salePricePaise).toBe(1000000);
    expect(fresh.currentBidPaise).toBe(1050000);
    expect(String(fresh.passedBidderIds[0])).toBe(String(top.user._id));
  });

  it('charges the second bidder their own price at checkout', async () => {
    const { second, auction } = await closeWithTwoBidders();
    await auctionCloser.expireUnpaid();
    stubCreateOrder('order_second_chance');

    const res = await asUser(second.token)
      .post(`/api/v1/auctions/${auction._id}/pay`)
      .send({ shippingAddress: ADDRESS });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(1000000);
  });

  it('marks the defaulting bid EXPIRED and the new holder WON', async () => {
    const { top, second, auction } = await closeWithTwoBidders();

    await auctionCloser.expireUnpaid();

    const topBid = await Bid.findOne({ auctionId: auction._id, bidderId: top.user._id });
    const secondBid = await Bid.findOne({ auctionId: auction._id, bidderId: second.user._id });
    expect(topBid.status).toBe(BID_STATUS.EXPIRED);
    expect(secondBid.status).toBe(BID_STATUS.WON);
  });

  it('never offers the same bidder twice', async () => {
    const { auction } = await closeWithTwoBidders();

    await auctionCloser.expireUnpaid();
    await Auction.updateOne({ _id: auction._id }, { paymentDueAt: new Date(Date.now() - 1000) });
    await auctionCloser.expireUnpaid();

    // Both bidders have now passed, so the device is unsold rather than being
    // offered back to the first defaulter.
    const fresh = await Auction.findById(auction._id);
    expect(fresh.status).toBe(AUCTION_STATUS.PAYMENT_EXPIRED);
    expect(fresh.passedBidderIds).toHaveLength(2);
  });

  it('ends unsold when second chances are switched off', async () => {
    await settings.update({ auctionSecondChanceEnabled: false });
    const { auction } = await closeWithTwoBidders();

    await auctionCloser.expireUnpaid();

    expect((await Auction.findById(auction._id)).status).toBe(AUCTION_STATUS.PAYMENT_EXPIRED);
  });
});

describe('buy now', () => {
  const liveWithBuyNow = async (overrides = {}) => {
    const seller = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id, {
      buyNowPricePaise: 2000000,
      ...overrides,
    });
    return { seller, auction };
  };

  it('ends the auction immediately and opens checkout at the instant price', async () => {
    const { auction } = await liveWithBuyNow();
    const buyer = await createAuctionUser();
    stubCreateOrder('order_buy_now_1');

    const res = await asUser(buyer.token)
      .post(`/api/v1/auctions/${auction._id}/buy-now`)
      .send({ shippingAddress: ADDRESS });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(2000000);

    const fresh = await Auction.findById(auction._id);
    expect(fresh.status).toBe(AUCTION_STATUS.PAYMENT_PENDING);
    expect(String(fresh.winnerId)).toBe(String(buyer.user._id));
    expect(fresh.salePricePaise).toBe(2000000);
    // No bid backs a Buy Now — the price came from the listing.
    expect(fresh.winningBidId).toBeNull();
  });

  it('marks existing bidders LOST', async () => {
    const { auction } = await liveWithBuyNow();
    const bidder = await createAuctionUser();
    const buyer = await createAuctionUser();
    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });
    stubCreateOrder('order_buy_now_2');

    await asUser(buyer.token)
      .post(`/api/v1/auctions/${auction._id}/buy-now`)
      .send({ shippingAddress: ADDRESS });

    const bid = await Bid.findOne({ auctionId: auction._id, bidderId: bidder.user._id });
    expect(bid.status).toBe(BID_STATUS.LOST);
  });

  it('refuses once bidding has passed the instant price', async () => {
    const { auction } = await liveWithBuyNow();
    const bidder = await createAuctionUser();
    const buyer = await createAuctionUser();
    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 2000000 });

    const res = await asUser(buyer.token)
      .post(`/api/v1/auctions/${auction._id}/buy-now`)
      .send({ shippingAddress: ADDRESS });

    expect(res.status).toBe(409);
    expect((await Auction.findById(auction._id)).status).toBe(AUCTION_STATUS.LIVE);
  });

  it('lets only one of two simultaneous instant buyers win', async () => {
    const { auction } = await liveWithBuyNow();
    const a = await createAuctionUser();
    const b = await createAuctionUser();
    stubCreateOrder('order_bn_race_a');
    stubCreateOrder('order_bn_race_b');

    const [one, two] = await Promise.all([
      asUser(a.token)
        .post(`/api/v1/auctions/${auction._id}/buy-now`)
        .send({ shippingAddress: ADDRESS }),
      asUser(b.token)
        .post(`/api/v1/auctions/${auction._id}/buy-now`)
        .send({ shippingAddress: ADDRESS }),
    ]);

    expect([one.status, two.status].sort()).toEqual([201, 409]);
  });

  it('refuses a listing with no instant price', async () => {
    const seller = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);
    const buyer = await createAuctionUser();

    const res = await asUser(buyer.token)
      .post(`/api/v1/auctions/${auction._id}/buy-now`)
      .send({ shippingAddress: ADDRESS });

    expect(res.status).toBe(409);
  });

  it('stops the seller buying their own listing', async () => {
    const { seller, auction } = await liveWithBuyNow();

    const res = await asUser(seller.token)
      .post(`/api/v1/auctions/${auction._id}/buy-now`)
      .send({ shippingAddress: ADDRESS });

    expect(res.status).toBe(403);
  });

  it('requires a delivery address', async () => {
    const { auction } = await liveWithBuyNow();
    const buyer = await createAuctionUser();

    const res = await asUser(buyer.token)
      .post(`/api/v1/auctions/${auction._id}/buy-now`)
      .send({});

    expect(res.status).toBe(422);
    expect((await Auction.findById(auction._id)).status).toBe(AUCTION_STATUS.LIVE);
  });

  it('rejects a malformed pincode', async () => {
    const { auction } = await liveWithBuyNow();
    const buyer = await createAuctionUser();

    const res = await asUser(buyer.token)
      .post(`/api/v1/auctions/${auction._id}/buy-now`)
      .send({ shippingAddress: { ...ADDRESS, pincode: '11' } });

    expect(res.status).toBe(422);
  });
});

describe('orders', () => {
  const buyNow = async () => {
    const seller = await createAuctionUser();
    const buyer = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id, { buyNowPricePaise: 2000000 });
    stubCreateOrder('order_orders_1');
    await asUser(buyer.token)
      .post(`/api/v1/auctions/${auction._id}/buy-now`)
      .send({ shippingAddress: ADDRESS });
    return { seller, buyer, auction };
  };

  it('records the order with its delivery address before payment', async () => {
    const { buyer } = await buyNow();

    const res = await asUser(buyer.token).get('/api/v1/orders');

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].shippingAddress.pincode).toBe('411001');
    expect(res.body.data.items[0].source).toBe('BUY_NOW');
    expect(res.body.data.items[0].paidAt).toBeNull();
    expect(res.body.data.items[0].fulfilmentStatus).toBe('PENDING');
  });

  it('marks the order paid when Razorpay confirms', async () => {
    const { buyer, auction } = await buyNow();

    const { body, signature } = buildWebhook('payment.captured', 'order_orders_1', 'pay_o1');
    await request(app)
      .post('/api/v1/wallet/webhook/razorpay')
      .set('x-razorpay-signature', signature)
      .set('Content-Type', 'application/json')
      .send(body);

    expect((await Auction.findById(auction._id)).status).toBe(AUCTION_STATUS.SOLD);
    const res = await asUser(buyer.token).get('/api/v1/orders');
    expect(res.body.data.items[0].paidAt).toBeTruthy();
  });

  it('keeps one buyer from seeing another buyer order', async () => {
    const { buyer } = await buyNow();
    const stranger = await createAuctionUser();

    const mine = await asUser(buyer.token).get('/api/v1/orders');
    const orderId = mine.body.data.items[0].id;

    const res = await asUser(stranger.token).get(`/api/v1/orders/${orderId}`);

    expect(res.status).toBe(404);
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

describe('admin listings and orders', () => {
  const listingBody = (overrides = {}) => ({
    device: { brand: 'Apple', model: 'iPhone 14', storageGb: 256 },
    condition: 'EXCELLENT',
    photos: [{ url: 'https://example.test/a.jpg', publicId: 'auctions/a.jpg' }],
    startPricePaise: 1500000,
    bidIncrementPaise: 50000,
    buyNowPricePaise: 2500000,
    startAt: new Date(Date.now() + 1000).toISOString(),
    endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  });

  it('creates a Grest listing owned by the platform account', async () => {
    const { token } = await createAdmin();

    const res = await asAdmin(token).post('/api/v1/admin/auctions').send(listingBody());

    expect(res.status).toBe(201);
    const auction = await Auction.findById(res.body.data.auction.id);
    expect(auction.sellerType).toBe('PLATFORM');
    expect(auction.status).toBe(AUCTION_STATUS.DRAFT);
    expect(auction.buyNowPricePaise).toBe(2500000);
  });

  it('publishes without charging a listing credit', async () => {
    const { token } = await createAdmin();
    // Start now, so it goes LIVE rather than SCHEDULED. A past start is
    // clamped to the moment of publishing.
    const created = await asAdmin(token)
      .post('/api/v1/admin/auctions')
      .send(listingBody({ startAt: new Date(Date.now() - 1000).toISOString() }));

    const res = await asAdmin(token).post(
      `/api/v1/admin/auctions/${created.body.data.auction.id}/publish`
    );

    expect(res.status).toBe(200);
    const auction = await Auction.findById(created.body.data.auction.id);
    expect(auction.status).toBe(AUCTION_STATUS.LIVE);
    // Grest billing itself would be meaningless.
    expect(auction.listingCost).toBe(0);
  });

  it('refuses an instant price at or below the start price', async () => {
    const { token } = await createAdmin();

    const res = await asAdmin(token)
      .post('/api/v1/admin/auctions')
      .send(listingBody({ buyNowPricePaise: 1500000 }));

    expect(res.status).toBe(422);
  });

  it('relists an unsold device as a fresh draft with no bid history', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);
    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });
    await Auction.updateOne(
      { _id: auction._id },
      { status: AUCTION_STATUS.PAYMENT_EXPIRED, endAt: new Date(Date.now() - 1000) }
    );

    const { token } = await createAdmin();
    const res = await asAdmin(token).post(`/api/v1/admin/auctions/${auction._id}/relist`);

    expect(res.status).toBe(201);
    const copy = await Auction.findById(res.body.data.auction.id);
    expect(copy.status).toBe(AUCTION_STATUS.DRAFT);
    expect(copy.bidCount).toBe(0);
    expect(copy.winnerId).toBeNull();
    expect(copy.passedBidderIds).toHaveLength(0);
    // The original is left as the record of what happened.
    expect((await Auction.findById(auction._id)).status).toBe(AUCTION_STATUS.PAYMENT_EXPIRED);
  });

  it('will not relist a live auction', async () => {
    const seller = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);
    const { token } = await createAdmin();

    const res = await asAdmin(token).post(`/api/v1/admin/auctions/${auction._id}/relist`);

    expect(res.status).toBe(409);
  });

  it('moves an order through dispatch and delivery', async () => {
    const seller = await createAuctionUser();
    const buyer = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id, { buyNowPricePaise: 2000000 });
    stubCreateOrder('order_admin_ful');
    await asUser(buyer.token)
      .post(`/api/v1/auctions/${auction._id}/buy-now`)
      .send({ shippingAddress: ADDRESS });

    const { token } = await createAdmin();
    const list = await asAdmin(token).get('/api/v1/admin/orders');
    const orderId = list.body.data.items[0].id;

    const dispatched = await asAdmin(token)
      .patch(`/api/v1/admin/orders/${orderId}`)
      .send({ status: 'DISPATCHED', note: 'Bluedart AWB 12345' });
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.data.order.dispatchedAt).toBeTruthy();
    expect(dispatched.body.data.order.notes[0].text).toBe('Bluedart AWB 12345');

    const delivered = await asAdmin(token)
      .patch(`/api/v1/admin/orders/${orderId}`)
      .send({ status: 'DELIVERED' });
    expect(delivered.body.data.order.fulfilmentStatus).toBe('DELIVERED');
  });

  it('refuses a status jump that skips dispatch', async () => {
    const seller = await createAuctionUser();
    const buyer = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id, { buyNowPricePaise: 2000000 });
    stubCreateOrder('order_admin_skip');
    await asUser(buyer.token)
      .post(`/api/v1/auctions/${auction._id}/buy-now`)
      .send({ shippingAddress: ADDRESS });

    const { token } = await createAdmin();
    const list = await asAdmin(token).get('/api/v1/admin/orders');

    const res = await asAdmin(token)
      .patch(`/api/v1/admin/orders/${list.body.data.items[0].id}`)
      .send({ status: 'DELIVERED' });

    expect(res.status).toBe(409);
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

describe('what the API tells the client about buying', () => {
  it('exposes the instant price and whether it can still be used', async () => {
    const seller = await createAuctionUser();
    const viewer = await createAuctionUser();
    await createLiveAuction(seller.user._id, { buyNowPricePaise: 2000000 });

    const res = await asUser(viewer.token).get('/api/v1/auctions');
    const [item] = res.body.data.items;

    expect(item.buyNowPricePaise).toBe(2000000);
    expect(item.buyNowPriceInr).toBe(20000);
    expect(item.canBuyNow).toBe(true);
  });

  it('turns canBuyNow off once bidding passes the instant price', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id, { buyNowPricePaise: 2000000 });
    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 2000000 });

    const res = await asUser(bidder.token).get(`/api/v1/auctions/${auction._id}`);

    expect(res.body.data.auction.canBuyNow).toBe(false);
  });

  it('reports null for a listing with no instant price', async () => {
    const seller = await createAuctionUser();
    const viewer = await createAuctionUser();
    await createLiveAuction(seller.user._id);

    const res = await asUser(viewer.token).get('/api/v1/auctions');

    expect(res.body.data.items[0].buyNowPricePaise).toBeNull();
    expect(res.body.data.items[0].canBuyNow).toBe(false);
  });

  it('tells the winner what they owe, not the top bid', async () => {
    const seller = await createAuctionUser();
    const top = await createAuctionUser();
    const second = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);
    await asUser(second.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });
    await asUser(top.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1050000 });
    await Auction.updateOne({ _id: auction._id }, { endAt: new Date(Date.now() - 1000) });
    await auctionCloser.closeAuction(auction._id);
    await Auction.updateOne({ _id: auction._id }, { paymentDueAt: new Date(Date.now() - 1000) });
    await auctionCloser.expireUnpaid();

    const res = await asUser(second.token).get(`/api/v1/auctions/${auction._id}`);

    expect(res.body.data.auction.youWon).toBe(true);
    expect(res.body.data.auction.salePricePaise).toBe(1000000);
    expect(res.body.data.auction.currentBidPaise).toBe(1050000);
  });

  it('keeps the sale price private from onlookers', async () => {
    const seller = await createAuctionUser();
    const winner = await createAuctionUser();
    const nosy = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id);
    await asUser(winner.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 1000000 });
    await Auction.updateOne({ _id: auction._id }, { endAt: new Date(Date.now() - 1000) });
    await auctionCloser.closeAuction(auction._id);

    const res = await asUser(nosy.token).get(`/api/v1/auctions/${auction._id}`);

    expect(res.body.data.auction.salePricePaise).toBeUndefined();
    expect(res.body.data.auction.winnerId).toBeUndefined();
  });
});

describe('instant price on the customer listing path', () => {
  it('persists buyNowPricePaise sent to POST /auctions', async () => {
    const { token } = await createAuctionUser();

    const res = await asUser(token)
      .post('/api/v1/auctions')
      .send(draftBody({ buyNowPricePaise: 2000000 }));

    expect(res.status).toBe(201);
    // The field used to be silently dropped here — the worst kind of failure,
    // because the form looked like it worked.
    expect(res.body.data.auction.buyNowPricePaise).toBe(2000000);
    const auction = await Auction.findById(res.body.data.auction.id);
    expect(auction.buyNowPricePaise).toBe(2000000);
  });

  it('lets a draft set the instant price later', async () => {
    const { token } = await createAuctionUser();
    const created = await asUser(token).post('/api/v1/auctions').send(draftBody());

    const res = await asUser(token)
      .patch(`/api/v1/auctions/${created.body.data.auction.id}`)
      .send({ buyNowPricePaise: 1800000 });

    expect(res.status).toBe(200);
    expect(res.body.data.auction.buyNowPricePaise).toBe(1800000);
  });

  it('refuses an instant price at or below the start price', async () => {
    const { token } = await createAuctionUser();

    const res = await asUser(token)
      .post('/api/v1/auctions')
      .send(draftBody({ startPricePaise: 1000000, buyNowPricePaise: 1000000 }));

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('buyNowPricePaise');
  });

  it('catches a PATCH that raises the start price above the instant price', async () => {
    const { token } = await createAuctionUser();
    const created = await asUser(token)
      .post('/api/v1/auctions')
      .send(draftBody({ buyNowPricePaise: 1200000 }));

    // Only the service can catch this: the body carries one field, the listing
    // holds the other.
    const res = await asUser(token)
      .patch(`/api/v1/auctions/${created.body.data.auction.id}`)
      .send({ startPricePaise: 1500000 });

    expect(res.status).toBe(400);
  });

  it('switches the instant price off the moment bidding passes it', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id, {
      startPricePaise: 4000000,
      bidIncrementPaise: 100000,
      buyNowPricePaise: 4600000, // ₹46,000
    });

    const before = await asUser(bidder.token).get(`/api/v1/auctions/${auction._id}`);
    expect(before.body.data.auction.canBuyNow).toBe(true);

    // Bidding climbs past the instant price — ₹47,000.
    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 4700000 });

    const after = await asUser(bidder.token).get(`/api/v1/auctions/${auction._id}`);
    expect(after.body.data.auction.canBuyNow).toBe(false);
    // The price is still reported, so the app can explain why the button went.
    expect(after.body.data.auction.buyNowPricePaise).toBe(4600000);
  });

  it('refuses the buy-now call itself once bidding has passed it', async () => {
    const seller = await createAuctionUser();
    const bidder = await createAuctionUser();
    const buyer = await createAuctionUser();
    const auction = await createLiveAuction(seller.user._id, {
      startPricePaise: 4000000,
      bidIncrementPaise: 100000,
      buyNowPricePaise: 4600000,
    });
    await asUser(bidder.token)
      .post(`/api/v1/auctions/${auction._id}/bids`)
      .send({ amountPaise: 4700000 });

    // Belt and braces: even a client that ignored canBuyNow cannot buy a device
    // for less than the standing top bid.
    const res = await asUser(buyer.token)
      .post(`/api/v1/auctions/${auction._id}/buy-now`)
      .send({ shippingAddress: ADDRESS });

    expect(res.status).toBe(409);
    expect((await Auction.findById(auction._id)).status).toBe(AUCTION_STATUS.LIVE);
  });
});
