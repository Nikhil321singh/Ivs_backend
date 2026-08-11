const { app, request, createUser, createFundedUser, asUser, balanceOf } = require('./helpers/factory');
const { stubCreateOrder, checkoutSignature, buildWebhook } = require('./helpers/razorpay');
const walletService = require('../src/services/wallet.service');

describe('wallet', () => {
  it('creates a wallet on first read', async () => {
    const { token } = await createUser();
    const res = await asUser(token).get('/api/v1/wallet');
    expect(res.status).toBe(200);
    expect(res.body.data.wallet.balance).toBe(0);
  });

  it('returns a paged statement', async () => {
    const { user, token } = await createFundedUser(100);
    await walletService.credit(user._id, 50, { reason: 'ADJUSTMENT' });

    const res = await asUser(token).get('/api/v1/wallet/transactions?page=1&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.pagination.total).toBeGreaterThan(0);
  });

  it('requires auth', async () => {
    expect((await request(app).get('/api/v1/wallet')).status).toBe(401);
  });
});

describe('token top-up', () => {
  it('rejects an amount below the minimum', async () => {
    const { token } = await createUser();
    const res = await asUser(token).post('/api/v1/wallet/topup/order').send({ amount: 1 });
    expect(res.status).toBe(400);
  });

  it('creates a Razorpay order', async () => {
    const { token } = await createUser();
    const orderId = stubCreateOrder('order_test_1');

    const res = await asUser(token).post('/api/v1/wallet/topup/order').send({ amount: 100 });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body.data)).toContain(orderId);
  });

  it('rejects a tampered checkout signature', async () => {
    const { token } = await createUser();
    stubCreateOrder('order_test_2');
    await asUser(token).post('/api/v1/wallet/topup/order').send({ amount: 100 });

    const res = await asUser(token).post('/api/v1/wallet/topup/verify')
      .send({ orderId: 'order_test_2', paymentId: 'pay_1', signature: 'forged' });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('credits tokens for a correctly signed payment', async () => {
    const { user, token } = await createUser();
    stubCreateOrder('order_test_3');
    await asUser(token).post('/api/v1/wallet/topup/order').send({ amount: 100 });

    const res = await asUser(token).post('/api/v1/wallet/topup/verify').send({
      orderId: 'order_test_3',
      paymentId: 'pay_3',
      signature: checkoutSignature('order_test_3', 'pay_3'),
    });

    expect(res.status).toBe(200);
    expect(await balanceOf(user._id)).toBeGreaterThanOrEqual(100);
  });

  it('rejects a webhook with a bad signature', async () => {
    const { body } = buildWebhook('payment.captured', 'order_x', 'pay_x');
    const res = await request(app)
      .post('/api/v1/wallet/webhook/razorpay')
      .set('x-razorpay-signature', 'wrong')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('wallet ledger invariants', () => {
  it('never lets a debit take the balance negative', async () => {
    const { user } = await createFundedUser(30);
    await expect(walletService.debit(user._id, 50, { reason: 'FEATURE_CHARGE' })).rejects.toThrow();
    expect(await balanceOf(user._id)).toBe(30);
  });

  it('is idempotent under a repeated key', async () => {
    const { user } = await createFundedUser(0);
    const opts = { reason: 'ADJUSTMENT', idempotencyKey: 'same-key' };

    await walletService.credit(user._id, 25, opts);
    await walletService.credit(user._id, 25, opts);

    expect(await balanceOf(user._id)).toBe(25);
  });

  it('survives concurrent debits without overdrawing', async () => {
    const { user } = await createFundedUser(100);

    const attempts = Array.from({ length: 10 }, () =>
      walletService.debit(user._id, 20, { reason: 'FEATURE_CHARGE' }).catch(() => null)
    );
    const results = await Promise.all(attempts);

    const succeeded = results.filter(Boolean).length;
    expect(succeeded).toBe(5);                       // 100 / 20
    expect(await balanceOf(user._id)).toBe(0);
  });
});

describe('referral', () => {
  it('returns the caller code and reward config', async () => {
    const { token } = await createUser({ referralCode: 'ABC1234' });
    const res = await asUser(token).get('/api/v1/referral');
    expect(res.status).toBe(200);
    expect(res.body.data.referralCode).toBe('ABC1234');
  });
});
