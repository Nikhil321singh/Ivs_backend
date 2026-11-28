const { app, request, createAdmin, createUser } = require('./helpers/factory');
const Payment = require('../src/models/Payment.model');
const VendorPayment = require('../src/models/VendorPayment.model');
const Wallet = require('../src/models/Wallet.model');
const WalletTransaction = require('../src/models/WalletTransaction.model');
const { PAYMENT_STATUS, TXN_TYPE, TXN_REASON, TXN_REF_TYPE } = require('../src/constants/walletEnums');
const { PAYMENT_PURPOSE } = require('../src/constants/entitlementEnums');
const mongoose = require('mongoose');

const asAdmin = (token) => ({
  get: (p) => request(app).get(p).set('Authorization', `Bearer ${token}`),
});

const rowFor = (rows, key) => rows.find((r) => r.key === key);

describe('admin payments summary', () => {
  it('totals real-money payments by purpose and excludes non-captured ones', async () => {
    const { token } = await createAdmin();
    const { user } = await createUser();

    await Payment.create([
      { userId: user._id, razorpayOrderId: 'o_topup', amountPaise: 10000, purpose: PAYMENT_PURPOSE.TOPUP, status: PAYMENT_STATUS.PAID },
      { userId: user._id, razorpayOrderId: 'o_plan', amountPaise: 79900, purpose: PAYMENT_PURPOSE.PLAN, status: PAYMENT_STATUS.PAID },
      { userId: user._id, razorpayOrderId: 'o_auction', amountPaise: 1000000, purpose: PAYMENT_PURPOSE.AUCTION, status: PAYMENT_STATUS.PAID },
      // Not captured — must not count toward cash.
      { userId: user._id, razorpayOrderId: 'o_pending', amountPaise: 50000, purpose: PAYMENT_PURPOSE.TOPUP, status: PAYMENT_STATUS.CREATED },
    ]);
    await VendorPayment.create({
      vendorId: new mongoose.Types.ObjectId(),
      razorpayOrderId: 'o_vendor',
      amountPaise: 200000,
      licences: 100,
      status: PAYMENT_STATUS.PAID,
    });

    const res = await asAdmin(token).get('/api/v1/admin/payments/summary');
    expect(res.status).toBe(200);
    const { rows, totals } = res.body.data;

    expect(rowFor(rows, PAYMENT_PURPOSE.TOPUP)).toMatchObject({ unit: 'INR', amount: 10000, count: 1 });
    expect(rowFor(rows, PAYMENT_PURPOSE.PLAN)).toMatchObject({ amount: 79900, count: 1 });
    expect(rowFor(rows, PAYMENT_PURPOSE.AUCTION)).toMatchObject({ amount: 1000000, count: 1 });
    expect(rowFor(rows, 'VENDOR_LICENCE')).toMatchObject({ amount: 200000, count: 1 });

    // Pending top-up excluded: cash is 10000 + 79900 + 1000000 + 200000.
    expect(totals.cashPaise).toBe(1289900);
  });

  it('buckets wallet feature charges under their feature', async () => {
    const { token } = await createAdmin();
    const { user } = await createUser();
    const wallet = await Wallet.create({ userId: user._id, balance: 1000 });

    await WalletTransaction.create([
      { walletId: wallet._id, userId: user._id, type: TXN_TYPE.DEBIT, reason: TXN_REASON.FEATURE_CHARGE, referenceType: TXN_REF_TYPE.IVS_CHECK, amount: 19, balanceBefore: 1000, balanceAfter: 981 },
      { walletId: wallet._id, userId: user._id, type: TXN_TYPE.DEBIT, reason: TXN_REASON.FEATURE_CHARGE, referenceType: TXN_REF_TYPE.IVS_CHECK, amount: 19, balanceBefore: 981, balanceAfter: 962 },
      { walletId: wallet._id, userId: user._id, type: TXN_TYPE.CREDIT, reason: TXN_REASON.REFERRAL_BONUS, amount: 50, balanceBefore: 962, balanceAfter: 1012 },
    ]);

    const res = await asAdmin(token).get('/api/v1/admin/payments/summary');
    const { rows } = res.body.data;

    expect(rowFor(rows, `FEATURE_CHARGE:${TXN_REF_TYPE.IVS_CHECK}`)).toMatchObject({
      unit: 'TOKENS',
      amount: 38, // two 19-token checks summed
      count: 2,
    });
    expect(rowFor(rows, TXN_REASON.REFERRAL_BONUS)).toMatchObject({ amount: 50, count: 1 });
  });

  it('collapses non-feature credit movements across features into one row', async () => {
    const { token } = await createAdmin();
    const { user } = await createUser();
    const EntitlementTransaction = require('../src/models/EntitlementTransaction.model');
    const { ENTITLEMENT_TXN_TYPE, ENTITLEMENT_REASON } = require('../src/constants/entitlementEnums');
    const entitlementId = new mongoose.Types.ObjectId();

    // One plan grant writes one row per feature; the summary must merge them.
    await EntitlementTransaction.create([
      { entitlementId, userId: user._id, type: ENTITLEMENT_TXN_TYPE.CREDIT, feature: 'IVS_CHECK', amount: 20, balanceBefore: 0, balanceAfter: 20, reason: ENTITLEMENT_REASON.PLAN_PURCHASE },
      { entitlementId, userId: user._id, type: ENTITLEMENT_TXN_TYPE.CREDIT, feature: 'DIAGNOSE', amount: 10, balanceBefore: 0, balanceAfter: 10, reason: ENTITLEMENT_REASON.PLAN_PURCHASE },
    ]);

    const res = await asAdmin(token).get('/api/v1/admin/payments/summary');
    const planRows = res.body.data.rows.filter((r) => r.key === ENTITLEMENT_REASON.PLAN_PURCHASE);
    expect(planRows).toHaveLength(1);
    expect(planRows[0]).toMatchObject({ unit: 'CREDITS', amount: 30, count: 2 });
  });

  it('rejects an unauthenticated request', async () => {
    expect((await request(app).get('/api/v1/admin/payments/summary')).status).toBe(401);
  });
});

describe('admin detailed payment statement', () => {
  it('merges all sources into one feed with Razorpay IDs, category and payer details', async () => {
    const { token } = await createAdmin();
    const { user } = await createUser({ name: 'Asha Rao', email: 'asha@test.local', companyName: 'Rao Traders' });
    const wallet = await Wallet.create({ userId: user._id, balance: 100 });

    await Payment.create({
      userId: user._id,
      razorpayOrderId: 'order_ABC',
      razorpayPaymentId: 'pay_ABC',
      amountPaise: 10000,
      purpose: PAYMENT_PURPOSE.TOPUP,
      status: PAYMENT_STATUS.PAID,
    });
    await WalletTransaction.create({
      walletId: wallet._id,
      userId: user._id,
      type: TXN_TYPE.DEBIT,
      reason: TXN_REASON.FEATURE_CHARGE,
      referenceType: TXN_REF_TYPE.IVS_CHECK,
      amount: 19,
      balanceBefore: 100,
      balanceAfter: 81,
    });

    const res = await request(app).get('/api/v1/admin/payments').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const { items, pagination } = res.body.data;
    expect(pagination.total).toBe(2);

    const topup = items.find((i) => i.razorpayPaymentId === 'pay_ABC');
    expect(topup).toMatchObject({
      group: 'CASH',
      category: 'Wallet top-up',
      unit: 'INR',
      amount: 10000,
      razorpayOrderId: 'order_ABC',
    });
    expect(topup.user).toMatchObject({ name: 'Asha Rao', email: 'asha@test.local', companyName: 'Rao Traders' });
    expect(topup.method).toBe('Razorpay');

    const check = items.find((i) => i.category === 'IMEI check (wallet)');
    expect(check).toMatchObject({ group: 'WALLET', unit: 'TOKENS', amount: 19, razorpayPaymentId: null });
    expect(check.user.name).toBe('Asha Rao');
  });

  it('filters the statement by group', async () => {
    const { token } = await createAdmin();
    const { user } = await createUser();
    const wallet = await Wallet.create({ userId: user._id, balance: 100 });
    await Payment.create({ userId: user._id, razorpayOrderId: 'o_1', amountPaise: 5000, purpose: PAYMENT_PURPOSE.TOPUP, status: PAYMENT_STATUS.PAID });
    await WalletTransaction.create({ walletId: wallet._id, userId: user._id, type: TXN_TYPE.DEBIT, reason: TXN_REASON.FEATURE_CHARGE, referenceType: TXN_REF_TYPE.IVS_CHECK, amount: 19, balanceBefore: 100, balanceAfter: 81 });

    const res = await request(app).get('/api/v1/admin/payments?group=CASH').set('Authorization', `Bearer ${token}`);
    expect(res.body.data.items.every((i) => i.group === 'CASH')).toBe(true);
    expect(res.body.data.items.length).toBe(1);
  });

  it('filters the statement by payment status, and tags method from the id shape', async () => {
    const { token } = await createAdmin();
    const { user } = await createUser();
    await Payment.create([
      { userId: user._id, razorpayOrderId: 'o_paid', razorpayPaymentId: 'pay_ok', amountPaise: 5000, purpose: PAYMENT_PURPOSE.AUCTION, status: PAYMENT_STATUS.PAID },
      { userId: user._id, razorpayOrderId: 'o_imps', razorpayPaymentId: 'IBKL261123506135', amountPaise: 7000, purpose: PAYMENT_PURPOSE.AUCTION, status: PAYMENT_STATUS.PAID },
      { userId: user._id, razorpayOrderId: 'o_created', amountPaise: 9000, purpose: PAYMENT_PURPOSE.AUCTION, status: PAYMENT_STATUS.CREATED },
    ]);

    const paid = await request(app).get('/api/v1/admin/payments?status=PAID').set('Authorization', `Bearer ${token}`);
    expect(paid.body.data.items.every((i) => i.status === 'PAID')).toBe(true);
    expect(paid.body.data.pagination.total).toBe(2);

    const methods = Object.fromEntries(paid.body.data.items.map((i) => [i.razorpayPaymentId, i.method]));
    expect(methods['pay_ok']).toBe('Razorpay');
    expect(methods['IBKL261123506135']).toBe('Bank / IMPS');

    const imps = await request(app).get('/api/v1/admin/payments?method=BANK_IMPS').set('Authorization', `Bearer ${token}`);
    expect(imps.body.data.items.map((i) => i.razorpayPaymentId)).toEqual(['IBKL261123506135']);

    const rzp = await request(app).get('/api/v1/admin/payments?method=RAZORPAY').set('Authorization', `Bearer ${token}`);
    expect(rzp.body.data.items.map((i) => i.razorpayPaymentId)).toEqual(['pay_ok']);
  });
});
