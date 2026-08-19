const { createFundedUser, createUser, asUser, balanceOf } = require('./helpers/factory');
const { stubCdot, stubCdotBlocked, stubAadhaar } = require('./helpers/providers');
const settings = require('../src/services/settings.service');
const ImeiLog = require('../src/models/ImeiVerificationLog.model');
const PRICING = require('../src/constants/pricing');

const IMEI = '355301083783251';
// Derived, not hardcoded: the price is operator-editable and its default has
// changed before, so asserting a literal here breaks the suite on a price
// change that is not a regression.
const COST = PRICING.FEATURES.IVS_CHECK;

describe('POST /ivs/verify', () => {
  it('returns CLEAN and charges the configured price', async () => {
    const { user, token } = await createFundedUser(500);
    stubCdot(IMEI, 'non-blocked');

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.status).toBe(200);
    expect(res.body.data.imei1Status).toBe('CLEAN');
    expect(res.body.data.allowTransaction).toBe(true);
    expect(res.body.data.wallet.charged).toBe(true);
    expect(await balanceOf(user._id)).toBe(500 - COST);
  });

  it('reports BLOCKED and still charges — a real answer was paid for', async () => {
    const { user, token } = await createFundedUser(500);
    stubCdot(IMEI, 'blocked');

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.body.data.imei1Status).toBe('BLOCKED');
    expect(res.body.data.allowTransaction).toBe(false);
    expect(await balanceOf(user._id)).toBe(500 - COST);
  });

  it('never charges when CEIR could not be reached', async () => {
    const WalletTransaction = require('../src/models/WalletTransaction.model');
    const { user, token } = await createFundedUser(500);
    stubCdotBlocked();                       // provider 403s

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.status).toBe(200);
    expect(res.body.data.wallet.charged).toBe(false);
    expect(await balanceOf(user._id)).toBe(500);

    // The debit now runs only after a definitive answer, so an unusable result
    // leaves the ledger untouched — no charge row, no compensating refund row.
    expect(await WalletTransaction.countDocuments({ userId: user._id })).toBe(0);
  });

  it('charges for a wrong/unknown IMEI — C-DOT bills us for that lookup', async () => {
    const WalletTransaction = require('../src/models/WalletTransaction.model');
    const PRICING = require('../src/constants/pricing');
    const { user, token } = await createFundedUser(500);
    // Login succeeds and CEIR responds, but the response carries no entry for
    // the IMEI we asked about — a real, billed lookup that found nothing.
    stubCdot('999999999999999', 'non-blocked');

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.status).toBe(200);
    expect(res.body.data.imei1Status).toBe('UNKNOWN');
    expect(res.body.data.wallet.charged).toBe(true);
    expect(await balanceOf(user._id)).toBe(500 - PRICING.FEATURES.IVS_CHECK);
    expect(await WalletTransaction.countDocuments({ userId: user._id })).toBe(1);
  });

  it('history agrees with what was actually charged', async () => {
    const PRICING = require('../src/constants/pricing');
    const { token } = await createFundedUser(500);
    stubCdot('999999999999999', 'non-blocked');   // billed lookup, UNKNOWN result

    await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });
    const history = await asUser(token).get('/api/v1/ivs/history');

    const [row] = history.body.data.items;
    expect(row.imei1Status).toBe('UNKNOWN');
    // An UNKNOWN that CEIR answered is billed, so history must not show it free.
    expect(row.charged).toBe(true);
    expect(row.cost).toBe(PRICING.FEATURES.IVS_CHECK);
  });

  it('history shows an unreachable check as free', async () => {
    const { token } = await createFundedUser(500);
    stubCdotBlocked();

    await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });
    const history = await asUser(token).get('/api/v1/ivs/history');

    const [row] = history.body.data.items;
    expect(row.charged).toBe(false);
    expect(row.cost).toBe(0);
  });

  it('does not charge when the CEIR call itself fails', async () => {
    const nock = require('nock');
    const WalletTransaction = require('../src/models/WalletTransaction.model');
    const { user, token } = await createFundedUser(500);

    // Login succeeds, but the lookup returns 500 on every attempt — the API did
    // not give us a successful response, so no lookup was billed to us.
    nock('https://ivs.test.gov').post('/api/login').reply(200, {
      accessToken: `header.${Buffer.from(
        JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })
      ).toString('base64')}.sig`,
      refreshToken: 'test-refresh',
    });
    nock('https://ivs.test.gov').post('/api/imei-status').times(5).reply(500, 'upstream boom');

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.status).toBe(200);
    expect(res.body.data.wallet.charged).toBe(false);
    expect(await balanceOf(user._id)).toBe(500);
    expect(await WalletTransaction.countDocuments({ userId: user._id })).toBe(0);
  });

  it('charges exactly once for a definitive answer', async () => {
    const WalletTransaction = require('../src/models/WalletTransaction.model');
    const PRICING = require('../src/constants/pricing');
    const { user, token } = await createFundedUser(500);
    stubCdot(IMEI, 'non-blocked');

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.status).toBe(200);
    expect(res.body.data.wallet.charged).toBe(true);
    expect(await balanceOf(user._id)).toBe(500 - PRICING.FEATURES.IVS_CHECK);

    const rows = await WalletTransaction.find({ userId: user._id });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('DEBIT');
    expect(rows[0].reason).toBe('FEATURE_CHARGE');
  });

  it('accepts `imei` as an alias for imei1', async () => {
    const { token } = await createFundedUser(500);
    stubCdot(IMEI, 'non-blocked');

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei: IMEI });
    expect(res.status).toBe(200);
    expect(res.body.data.imei1Status).toBe('CLEAN');
  });

  it('402s with the real balance when funds are short', async () => {
    const { token } = await createFundedUser(5);

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.status).toBe(402);
    expect(res.body.errors[0]).toMatchObject({ balance: 5, required: COST, shortfall: COST - 5 });
  });

  it('rejects a malformed IMEI', async () => {
    const { token } = await createFundedUser(500);
    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: '123' });
    expect(res.status).toBe(422);
  });

  it('charges the operator-set price, not the compiled default', async () => {
    await settings.update({ ivsCheckCost: 35 });
    const { user, token } = await createFundedUser(500);
    stubCdot(IMEI, 'non-blocked');

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.body.data.wallet.cost).toBe(35);
    expect(await balanceOf(user._id)).toBe(465);
  });

  it('stores the price paid so history cannot be re-priced later', async () => {
    await settings.update({ ivsCheckCost: 35 });
    const { user, token } = await createFundedUser(500);
    stubCdot(IMEI, 'non-blocked');
    await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    await settings.update({ ivsCheckCost: 99 });
    const res = await asUser(token).get('/api/v1/ivs/history');

    expect(res.body.data.items[0].cost).toBe(35);
    expect(await ImeiLog.countDocuments({ userId: user._id })).toBe(1);
  });

  it('records the customer name', async () => {
    const { token } = await createFundedUser(500);
    stubCdot(IMEI, 'non-blocked');
    await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI, customerName: 'Ramesh' });

    const res = await asUser(token).get('/api/v1/ivs/history');
    expect(res.body.data.items[0].customerName).toBe('Ramesh');
  });

  it('rejects an over-long customer name', async () => {
    const { token } = await createFundedUser(500);
    const res = await asUser(token).post('/api/v1/ivs/verify')
      .send({ imei1: IMEI, customerName: 'x'.repeat(200) });
    expect(res.status).toBe(422);
  });
});

describe('GET /ivs/history', () => {
  it('requires authentication', async () => {
    const { request, app } = require('./helpers/factory');
    const res = await request(app).get('/api/v1/ivs/history');
    expect(res.status).toBe(401);
  });

  it('returns only the caller rows', async () => {
    const a = await createFundedUser(500);
    const b = await createFundedUser(500);
    stubCdot(IMEI, 'non-blocked');
    await asUser(a.token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    const res = await asUser(b.token).get('/api/v1/ivs/history');
    expect(res.body.data.items).toHaveLength(0);
  });
});

describe('customer Aadhaar in the IMEI flow', () => {
  it('sends and verifies an OTP through the provider', async () => {
    const { token } = await createUser();
    stubAadhaar({ clientId: 'cid-1', verifySuccess: true });

    const send = await asUser(token).post('/api/v1/ivs/aadhaar/send-otp')
      .send({ aadhaarNumber: '234567890123' });
    expect(send.status).toBe(200);
    expect(send.body.data.refId).toBe('cid-1');

    const verify = await asUser(token).post('/api/v1/ivs/aadhaar/verify-otp')
      .send({ refId: 'cid-1', otp: '123456' });
    expect(verify.status).toBe(200);
  });

  it('no-ops with an empty body when Aadhaar is switched off', async () => {
    await settings.update({ aadhaarVerificationEnabled: false });
    const { token } = await createUser();

    const send = await asUser(token).post('/api/v1/ivs/aadhaar/send-otp').send({});
    const verify = await asUser(token).post('/api/v1/ivs/aadhaar/verify-otp').send({});

    expect(send.status).toBe(200);
    expect(verify.status).toBe(200);
  });
});
