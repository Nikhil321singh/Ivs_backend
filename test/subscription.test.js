const {
  app,
  request,
  createUser,
  createCreditedUser,
  createFundedUser,
  createAdmin,
  seedPlans,
  asUser,
  balanceOf,
  creditsOf,
} = require('./helpers/factory');
const { stubCdot, stubCdotBlocked } = require('./helpers/providers');
const { stubCreateOrder, checkoutSignature, buildWebhook } = require('./helpers/razorpay');
const settings = require('../src/services/settings.service');
const EntitlementTransaction = require('../src/models/EntitlementTransaction.model');
const Plan = require('../src/models/Plan.model');

const IMEI = '355301083783251';

const asAdmin = (token) => ({
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${token}`),
  post: (path) => request(app).post(path).set('Authorization', `Bearer ${token}`),
  patch: (path) => request(app).patch(path).set('Authorization', `Bearer ${token}`),
});

describe('GET /plans', () => {
  it('returns the catalogue with server-computed rates and the custom tier', async () => {
    await seedPlans();
    const { token } = await createUser();

    const res = await asUser(token).get('/api/v1/plans');

    expect(res.status).toBe(200);
    expect(res.body.data.plans.map((p) => p.code)).toEqual(['BASIC', 'PRO', 'PRO_MAX']);

    const pro = res.body.data.plans.find((p) => p.code === 'PRO');
    // Everything the card renders comes from the server, so pricing can be
    // retuned without an app release.
    expect(pro.priceInr).toBe(1299);
    expect(pro.badge).toBe('Most popular');
    expect(pro.discountPercent).toBeGreaterThan(0);
    expect(pro.rates.IVS_CHECK).toBeGreaterThan(0);
    // MRP is derived from the list prices, so the advertised saving is real.
    expect(pro.mrpPaise).toBe(30 * 1900 + 20 * 5000);
  });

  it('prices the custom tier strictly below Pro Max, per check', async () => {
    await seedPlans();
    const { token } = await createUser();

    const res = await asUser(token).get('/api/v1/plans');
    const proMax = res.body.data.plans.find((p) => p.code === 'PRO_MAX');
    const { custom } = res.body.data;

    // The whole point of anchoring custom to Pro Max rather than to list price:
    // buying in volume must never be worse value than a pack.
    expect(custom.rates.IVS_CHECK).toBeLessThan(proMax.rates.IVS_CHECK);
    expect(custom.rates.DIAGNOSE).toBeLessThan(proMax.rates.DIAGNOSE);
    expect(custom.minimums).toEqual({ IVS_CHECK: 100, DIAGNOSE: 50 });
  });

  it('hides plans aimed at a different audience', async () => {
    await seedPlans();
    await Plan.create({
      code: 'VENDOR_ONLY',
      name: 'Vendor only',
      tier: 'PRO',
      quotas: { IVS_CHECK: 30, DIAGNOSE: 20 },
      pricePaise: 129900,
      audience: 'vendor',
      sortOrder: 4,
    });

    const { token } = await createUser({ userType: 'individual' });
    const res = await asUser(token).get('/api/v1/plans');

    expect(res.body.data.plans.map((p) => p.code)).not.toContain('VENDOR_ONLY');
  });
});

describe('POST /plans/custom/quote', () => {
  it('refuses a quantity below the minimum and says what the minimum is', async () => {
    await seedPlans();
    const { token } = await createUser();

    const res = await asUser(token)
      .post('/api/v1/plans/custom/quote')
      .send({ quantities: { IVS_CHECK: 10, DIAGNOSE: 5 } });

    expect(res.status).toBe(400);
    expect(res.body.errors[0]).toMatchObject({ feature: 'IVS_CHECK', minimum: 100 });
  });

  it('prices a valid quantity below the Pro Max rate', async () => {
    await seedPlans();
    const { token } = await createUser();

    const list = await asUser(token).get('/api/v1/plans');
    const proMaxRate = list.body.data.plans.find((p) => p.code === 'PRO_MAX').rates.IVS_CHECK;

    const res = await asUser(token)
      .post('/api/v1/plans/custom/quote')
      .send({ quantities: { IVS_CHECK: 100, DIAGNOSE: 50 } });

    expect(res.status).toBe(200);
    expect(res.body.data.quotas).toEqual({ IVS_CHECK: 100, DIAGNOSE: 50 });
    expect(res.body.data.rates.IVS_CHECK).toBeLessThan(proMaxRate);
    // Rounded up to a whole rupee so it sits alongside the packs.
    expect(res.body.data.pricePaise % 100).toBe(0);
  });
});

describe('POST /subscription/order', () => {
  it('ignores a price supplied by the client', async () => {
    await seedPlans();
    const { token } = await createUser();
    stubCreateOrder('order_plan_1');

    const res = await asUser(token)
      .post('/api/v1/subscription/order')
      .send({ planCode: 'PRO', pricePaise: 1, amount: 1 });

    expect(res.status).toBe(201);
    // The server's price, not the one the client asked for.
    expect(res.body.data.amount).toBe(129900);
  });

  it('refuses a custom order below the minimum', async () => {
    await seedPlans();
    const { token } = await createUser();

    const res = await asUser(token)
      .post('/api/v1/subscription/order')
      .send({ quantities: { IVS_CHECK: 5, DIAGNOSE: 5 } });

    expect(res.status).toBe(400);
  });

  it('rejects an order naming both a plan and a quantity', async () => {
    await seedPlans();
    const { token } = await createUser();

    const res = await asUser(token)
      .post('/api/v1/subscription/order')
      .send({ planCode: 'PRO', quantities: { IVS_CHECK: 100, DIAGNOSE: 50 } });

    expect(res.status).toBe(422);
  });

  it('will not sell a deactivated plan', async () => {
    await seedPlans();
    await Plan.updateOne({ code: 'PRO' }, { isActive: false });
    const { token } = await createUser();

    const res = await asUser(token).post('/api/v1/subscription/order').send({ planCode: 'PRO' });

    expect(res.status).toBe(400);
  });
});

describe('credit pack fulfilment', () => {
  const buyPro = async (token, orderId) => {
    stubCreateOrder(orderId);
    await asUser(token).post('/api/v1/subscription/order').send({ planCode: 'PRO' });
  };

  const fireWebhook = (orderId, paymentId) => {
    const { body, signature } = buildWebhook('payment.captured', orderId, paymentId);
    return request(app)
      .post('/api/v1/wallet/webhook/razorpay')
      .set('x-razorpay-signature', signature)
      .set('Content-Type', 'application/json')
      .send(body);
  };

  it('grants every feature in the pack when Razorpay confirms', async () => {
    await seedPlans();
    const { user, token } = await createUser();
    await buyPro(token, 'order_ff_1');

    await fireWebhook('order_ff_1', 'pay_ff_1');

    expect(await creditsOf(user._id, 'IVS_CHECK')).toBe(30);
    expect(await creditsOf(user._id, 'DIAGNOSE')).toBe(20);
    // One ledger row per feature, so "where did my checks go" is answerable.
    expect(await EntitlementTransaction.countDocuments({ userId: user._id })).toBe(2);
  });

  it('grants exactly once when the webhook is replayed', async () => {
    await seedPlans();
    const { user, token } = await createUser();
    await buyPro(token, 'order_ff_2');

    await fireWebhook('order_ff_2', 'pay_ff_2');
    await fireWebhook('order_ff_2', 'pay_ff_2');

    expect(await creditsOf(user._id, 'IVS_CHECK')).toBe(30);
    expect(await EntitlementTransaction.countDocuments({ userId: user._id })).toBe(2);
  });

  it('grants exactly once when the verify fast-path races the webhook', async () => {
    await seedPlans();
    const { user, token } = await createUser();
    await buyPro(token, 'order_ff_3');

    const verify = await asUser(token).post('/api/v1/subscription/verify').send({
      orderId: 'order_ff_3',
      paymentId: 'pay_ff_3',
      signature: checkoutSignature('order_ff_3', 'pay_ff_3'),
    });
    await fireWebhook('order_ff_3', 'pay_ff_3');

    expect(verify.status).toBe(200);
    expect(verify.body.data.credits.IVS_CHECK).toBe(30);
    expect(await creditsOf(user._id, 'IVS_CHECK')).toBe(30);
  });

  it('credits nothing until the payment is confirmed', async () => {
    await seedPlans();
    const { user, token } = await createUser();
    await buyPro(token, 'order_ff_4');

    expect(await creditsOf(user._id, 'IVS_CHECK')).toBe(0);
  });

  it('credits what was sold, even after the plan is repriced', async () => {
    await seedPlans();
    const { user, token } = await createUser();
    await buyPro(token, 'order_ff_5');

    // An admin re-quotas the plan between checkout and capture.
    await Plan.updateOne({ code: 'PRO' }, { quotas: { IVS_CHECK: 1, DIAGNOSE: 1 } });

    await fireWebhook('order_ff_5', 'pay_ff_5');

    // The snapshot wins — the customer gets what they paid for.
    expect(await creditsOf(user._id, 'IVS_CHECK')).toBe(30);
  });
});

describe('spending credits on a paid feature', () => {
  it('consumes exactly one credit for a definitive answer', async () => {
    const { user, token } = await createCreditedUser({ IVS_CHECK: 3 });
    stubCdot(IMEI, 'non-blocked');

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.status).toBe(200);
    expect(res.body.data.imei1Status).toBe('CLEAN');
    expect(res.body.data.billing).toMatchObject({ source: 'ENTITLEMENT', charged: true });
    expect(res.body.data.credits.IVS_CHECK).toBe(2);
    expect(await creditsOf(user._id, 'IVS_CHECK')).toBe(2);
  });

  it('charges no tokens when billed in credits', async () => {
    const { user, token } = await createCreditedUser({ IVS_CHECK: 3 });
    stubCdot(IMEI, 'non-blocked');

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.body.data.billing.cost).toBe(0);
    expect(res.body.data.wallet.charged).toBe(false);
    expect(await balanceOf(user._id)).toBe(0);
  });

  it('402s with the remaining count when credits run out', async () => {
    const { token } = await createCreditedUser({ IVS_CHECK: 0 });

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.status).toBe(402);
    expect(res.body.errors[0]).toMatchObject({
      feature: 'IVS_CHECK',
      remaining: 0,
      required: 1,
    });
  });

  it('never consumes a credit when CEIR could not be reached', async () => {
    const { user, token } = await createCreditedUser({ IVS_CHECK: 3 });
    stubCdotBlocked();

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.status).toBe(200);
    expect(res.body.data.billing.charged).toBe(false);
    expect(await creditsOf(user._id, 'IVS_CHECK')).toBe(3);
    expect(await EntitlementTransaction.countDocuments({ userId: user._id })).toBe(0);
  });

  it('cannot be double-spent by concurrent requests', async () => {
    const { user, token } = await createCreditedUser({ IVS_CHECK: 1 });
    stubCdot(IMEI, 'non-blocked', { times: 2 });

    const [a, b] = await Promise.all([
      asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI }),
      asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI }),
    ]);

    // We pay C-DOT for both lookups but can bill only one; the other is
    // withheld rather than served free. The counter never goes negative.
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 402]);
    expect(await creditsOf(user._id, 'IVS_CHECK')).toBe(0);
  });

  it('records the billing source so history is not re-priced in tokens', async () => {
    const { token } = await createCreditedUser({ IVS_CHECK: 3 });
    stubCdot(IMEI, 'non-blocked');
    await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    const res = await asUser(token).get('/api/v1/ivs/history');
    const [row] = res.body.data.items;

    expect(row.charged).toBe(true);
    expect(row.billingSource).toBe('ENTITLEMENT');
    expect(row.cost).toBe(0);
    expect(row.creditsUsed).toBe(1);
  });
});

describe('billingMode', () => {
  it('BOTH spends credits first', async () => {
    await settings.update({ billingMode: 'BOTH' });
    const { user, token } = await createCreditedUser({ IVS_CHECK: 2 });
    stubCdot(IMEI, 'non-blocked');

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.body.data.billing.source).toBe('ENTITLEMENT');
    expect(await creditsOf(user._id, 'IVS_CHECK')).toBe(1);
  });

  it('BOTH falls back to the wallet when credits are gone, so tokens are not stranded', async () => {
    await settings.update({ billingMode: 'BOTH' });
    const { user, token } = await createFundedUser(500);
    stubCdot(IMEI, 'non-blocked');

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.status).toBe(200);
    expect(res.body.data.billing.source).toBe('WALLET');
    expect(await balanceOf(user._id)).toBeLessThan(500);
  });

  it('SUBSCRIPTION stops selling tokens nothing can spend', async () => {
    const { token } = await createUser();

    const res = await asUser(token).post('/api/v1/wallet/topup/order').send({ amount: 100 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/plan/i);
  });

  it('BOTH still sells tokens, because they are still spendable', async () => {
    await settings.update({ billingMode: 'BOTH' });
    const { token } = await createUser();
    stubCreateOrder('order_both_topup');

    const res = await asUser(token).post('/api/v1/wallet/topup/order').send({ amount: 100 });

    expect(res.status).toBe(201);
  });

  it('SUBSCRIPTION refuses a token-funded user with no credits', async () => {
    const { token } = await createFundedUser(500);

    const res = await asUser(token).post('/api/v1/ivs/verify').send({ imei1: IMEI });

    expect(res.status).toBe(402);
  });
});

describe('admin credit controls', () => {
  it('grants credits through the ledger, stamped with the admin and the reason', async () => {
    const { user } = await createUser();
    const { admin, token } = await createAdmin();

    const res = await asAdmin(token)
      .post(`/api/v1/admin/entitlements/${user._id}/adjust`)
      .send({ feature: 'IVS_CHECK', delta: 5, note: 'Goodwill for failed check REF-1' });

    expect(res.status).toBe(200);
    expect(res.body.data.credits.IVS_CHECK).toBe(5);

    const row = await EntitlementTransaction.findOne({ userId: user._id });
    expect(row.reason).toBe('ADMIN_ADJUSTMENT');
    expect(String(row.adminId)).toBe(String(admin._id));
    expect(row.note).toBe('Goodwill for failed check REF-1');
  });

  it('requires a note, so an adjustment is always explainable', async () => {
    const { user } = await createUser();
    const { token } = await createAdmin();

    const res = await asAdmin(token)
      .post(`/api/v1/admin/entitlements/${user._id}/adjust`)
      .send({ feature: 'IVS_CHECK', delta: 5 });

    expect(res.status).toBe(422);
  });

  it('will not deduct more credits than the customer holds', async () => {
    const { user } = await createCreditedUser({ IVS_CHECK: 2 });
    const { token } = await createAdmin();

    const res = await asAdmin(token)
      .post(`/api/v1/admin/entitlements/${user._id}/adjust`)
      .send({ feature: 'IVS_CHECK', delta: -5, note: 'clawback' });

    expect(res.status).toBe(402);
    expect(await creditsOf(user._id, 'IVS_CHECK')).toBe(2);
  });

  it('rejects a plan price that would undercut the custom tier', async () => {
    await seedPlans();
    const { token } = await createAdmin();

    // ₹100 for 20 checks + 10 diagnoses is far below the volume rate, so a
    // small pack would beat buying 100 — the one misconfiguration that must
    // never reach customers.
    const res = await asAdmin(token).patch(
      `/api/v1/admin/plans/${(await Plan.findOne({ code: 'BASIC' }))._id}`
    ).send({ pricePaise: 10000 });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('BASIC');
  });

  it('accepts a sane reprice and reports it back with the new rates', async () => {
    await seedPlans();
    const { token } = await createAdmin();

    const res = await asAdmin(token).patch(
      `/api/v1/admin/plans/${(await Plan.findOne({ code: 'BASIC' }))._id}`
    ).send({ pricePaise: 84900, badge: 'Starter' });

    expect(res.status).toBe(200);
    expect(res.body.data.plan.pricePaise).toBe(84900);
    expect(res.body.data.plan.badge).toBe('Starter');
  });
});
