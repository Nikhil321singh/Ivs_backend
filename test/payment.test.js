const request = require('supertest');
const app = require('../src/app');
const Payment = require('../src/models/Payment.model');
const WalletTransaction = require('../src/models/WalletTransaction.model');
const { PAYMENT_STATUS } = require('../src/constants/walletEnums');
const PRICING = require('../src/constants/pricing');
const { createUserWithToken } = require('./helpers/factories');
const {
  checkoutSignature,
  stubCreateOrder,
  buildWebhook,
} = require('./helpers/razorpay');

const WEBHOOK_URL = '/api/v1/wallet/webhook/razorpay';

/** Creates a top-up order through the real endpoint; returns { orderId, tokens }. */
const createOrder = async (authHeader, amount = 100) => {
  const orderId = stubCreateOrder(`order_${Math.random().toString(36).slice(2)}`);
  const res = await request(app)
    .post('/api/v1/wallet/topup/order')
    .set('Authorization', authHeader)
    .send({ amount });
  expect(res.status).toBe(201);
  return { orderId, tokens: res.body.data.tokens };
};

const postWebhook = (event, orderId, paymentId) => {
  const { body, signature } = buildWebhook(event, orderId, paymentId);
  return request(app)
    .post(WEBHOOK_URL)
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', signature)
    .send(body);
};

const getBalance = async (authHeader) => {
  const res = await request(app).get('/api/v1/wallet').set('Authorization', authHeader);
  return res.body.data.wallet.balance;
};

describe('Payment — order creation', () => {
  it('creates a CREATED payment without crediting any tokens', async () => {
    const { authHeader } = await createUserWithToken();
    const { orderId } = await createOrder(authHeader, 100);

    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    expect(payment.status).toBe(PAYMENT_STATUS.CREATED);
    expect(payment.tokens).toBe(100 * PRICING.TOKEN_PER_INR);
    expect(await getBalance(authHeader)).toBe(0);
  });

  it('rejects an amount below the minimum', async () => {
    const { authHeader } = await createUserWithToken();
    const res = await request(app)
      .post('/api/v1/wallet/topup/order')
      .set('Authorization', authHeader)
      .send({ amount: PRICING.MIN_TOPUP_INR - 1 });
    expect(res.status).toBe(400);
    expect(await Payment.countDocuments()).toBe(0);
  });

  it('rejects an amount above the maximum', async () => {
    const { authHeader } = await createUserWithToken();
    const res = await request(app)
      .post('/api/v1/wallet/topup/order')
      .set('Authorization', authHeader)
      .send({ amount: PRICING.MAX_TOPUP_INR + 1 });
    expect(res.status).toBe(400);
  });
});

describe('Payment — successful capture credits exactly once', () => {
  it('credits tokens on a valid /verify', async () => {
    const { authHeader } = await createUserWithToken();
    const { orderId, tokens } = await createOrder(authHeader, 100);
    const paymentId = 'pay_success_1';

    const res = await request(app)
      .post('/api/v1/wallet/topup/verify')
      .set('Authorization', authHeader)
      .send({ orderId, paymentId, signature: checkoutSignature(orderId, paymentId) });

    expect(res.status).toBe(200);
    expect(res.body.data.balance).toBe(tokens);
    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    expect(payment.status).toBe(PAYMENT_STATUS.PAID);
    expect(await WalletTransaction.countDocuments({ userId: payment.userId })).toBe(1);
  });

  it('credits tokens on a valid webhook (source of truth)', async () => {
    const { authHeader } = await createUserWithToken();
    const { orderId, tokens } = await createOrder(authHeader, 250);
    const paymentId = 'pay_success_2';

    const res = await postWebhook('payment.captured', orderId, paymentId);

    expect(res.status).toBe(200);
    expect(await getBalance(authHeader)).toBe(tokens);
    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    expect(payment.status).toBe(PAYMENT_STATUS.PAID);
  });

  it('does NOT double-credit when /verify and webhook both report the same payment', async () => {
    const { authHeader } = await createUserWithToken();
    const { orderId, tokens } = await createOrder(authHeader, 100);
    const paymentId = 'pay_dup_1';

    await request(app)
      .post('/api/v1/wallet/topup/verify')
      .set('Authorization', authHeader)
      .send({ orderId, paymentId, signature: checkoutSignature(orderId, paymentId) });
    await postWebhook('payment.captured', orderId, paymentId);

    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    expect(await getBalance(authHeader)).toBe(tokens);
    expect(await WalletTransaction.countDocuments({ userId: payment.userId })).toBe(1);
  });

  it('is idempotent when Razorpay retries the same webhook', async () => {
    const { authHeader } = await createUserWithToken();
    const { orderId, tokens } = await createOrder(authHeader, 100);
    const paymentId = 'pay_retry_1';

    await postWebhook('payment.captured', orderId, paymentId);
    await postWebhook('payment.captured', orderId, paymentId);
    await postWebhook('payment.captured', orderId, paymentId);

    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    expect(await getBalance(authHeader)).toBe(tokens);
    expect(await WalletTransaction.countDocuments({ userId: payment.userId })).toBe(1);
  });

  it('credits once even under a concurrent verify+webhook race', async () => {
    const { authHeader } = await createUserWithToken();
    const { orderId, tokens } = await createOrder(authHeader, 100);
    const paymentId = 'pay_race_1';

    await Promise.all([
      request(app)
        .post('/api/v1/wallet/topup/verify')
        .set('Authorization', authHeader)
        .send({ orderId, paymentId, signature: checkoutSignature(orderId, paymentId) }),
      postWebhook('payment.captured', orderId, paymentId),
    ]);

    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    expect(await getBalance(authHeader)).toBe(tokens);
    expect(await WalletTransaction.countDocuments({ userId: payment.userId })).toBe(1);
  });
});

describe('Payment — unsuccessful / forged payments credit nothing', () => {
  it('rejects a forged checkout signature on /verify with 400 and no credit', async () => {
    const { authHeader } = await createUserWithToken();
    const { orderId } = await createOrder(authHeader, 100);

    const res = await request(app)
      .post('/api/v1/wallet/topup/verify')
      .set('Authorization', authHeader)
      .send({ orderId, paymentId: 'pay_forged', signature: 'deadbeef_not_a_real_signature' });

    expect(res.status).toBe(400);
    expect(await getBalance(authHeader)).toBe(0);
    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    expect(payment.status).toBe(PAYMENT_STATUS.CREATED);
  });

  it('rejects a webhook with a tampered body/signature with 400 and no credit', async () => {
    const { authHeader } = await createUserWithToken();
    const { orderId } = await createOrder(authHeader, 100);
    const { body } = buildWebhook('payment.captured', orderId, 'pay_tampered');

    const res = await request(app)
      .post(WEBHOOK_URL)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'wrong_signature')
      .send(body);

    expect(res.status).toBe(400);
    expect(await getBalance(authHeader)).toBe(0);
  });

  it('marks the payment FAILED on a payment.failed webhook and credits nothing', async () => {
    const { authHeader } = await createUserWithToken();
    const { orderId } = await createOrder(authHeader, 100);

    const res = await postWebhook('payment.failed', orderId, 'pay_failed_1');

    expect(res.status).toBe(200);
    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    expect(payment.status).toBe(PAYMENT_STATUS.FAILED);
    expect(await getBalance(authHeader)).toBe(0);
  });

  it('leaves an abandoned order as CREATED with no tokens', async () => {
    const { authHeader } = await createUserWithToken();
    const { orderId } = await createOrder(authHeader, 100);

    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    expect(payment.status).toBe(PAYMENT_STATUS.CREATED);
    expect(await getBalance(authHeader)).toBe(0);
  });

  it('returns 404 when verifying an unknown order', async () => {
    const { authHeader } = await createUserWithToken();
    const orderId = 'order_does_not_exist';

    const res = await request(app)
      .post('/api/v1/wallet/topup/verify')
      .set('Authorization', authHeader)
      .send({ orderId, paymentId: 'pay_x', signature: checkoutSignature(orderId, 'pay_x') });

    expect(res.status).toBe(404);
  });
});
