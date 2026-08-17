const jwt = require('jsonwebtoken');
const { createUser, createFundedUser, request, app } = require('./helpers/factory');
const User = require('../src/models/User.model');
const Admin = require('../src/admin/models/Admin.model');
const Payment = require('../src/models/Payment.model');
const ImeiVerificationLog = require('../src/models/ImeiVerificationLog.model');
const walletService = require('../src/services/wallet.service');
const { TXN_REASON, TXN_REF_TYPE } = require('../src/constants/walletEnums');
const env = require('../src/config/env');

let adminCounter = 0;

/**
 * An admin token minted directly rather than through POST /admin/login, which
 * is rate-limited to 10 attempts per window — enough specs in this file to trip
 * it and fail on the limiter instead of on the behaviour under test. Signing
 * the same claims adminService.login would is equivalent for these routes.
 */
const createAdminToken = async () => {
  adminCounter += 1;
  const admin = await Admin.create({
    email: `users-admin${adminCounter}@test.local`,
    passwordHash: 'not-used-this-path',
    name: 'Test Admin',
  });

  return {
    admin,
    token: jwt.sign(
      { sub: admin._id.toString(), typ: 'admin', email: admin.email },
      env.adminJwt.secret,
      { expiresIn: env.adminJwt.expiry }
    ),
  };
};

const asAdmin = (token) => ({
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${token}`),
});

describe('GET /admin/users', () => {
  it('rejects an unauthenticated caller', async () => {
    const res = await request(app).get('/api/v1/admin/users');
    expect(res.status).toBe(401);
  });

  it('rejects a user token — admin routes need typ=admin', async () => {
    const { token } = await createUser();
    const res = await asAdmin(token).get('/api/v1/admin/users');
    expect(res.status).toBe(401);
  });

  it('lists users newest first with their wallet balance', async () => {
    const { token } = await createAdminToken();
    await createUser({ name: 'Older' });
    await createFundedUser(250, { name: 'Newer' });

    const res = await asAdmin(token).get('/api/v1/admin/users');

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.items[0].name).toBe('Newer');
    expect(res.body.data.items[0].balance).toBe(250);
    expect(res.body.data.items[1].balance).toBe(0);
    expect(res.body.data.pagination.total).toBe(2);
  });

  it('never exposes internal fields in the list', async () => {
    const { token } = await createAdminToken();
    const { user } = await createUser();
    await User.findByIdAndUpdate(user._id, {
      aadhaarNumberHash: 'hash-should-not-leak',
      profileImagePublicId: 'users/should-not-leak',
    });

    const res = await asAdmin(token).get('/api/v1/admin/users');

    expect(JSON.stringify(res.body)).not.toContain('should-not-leak');
    expect(res.body.data.items[0].id).toBe(user._id.toString());
    expect(res.body.data.items[0]._id).toBeUndefined();
  });

  it('searches across mobile, name, company, email, PAN, GST and referral code', async () => {
    const { token } = await createAdminToken();
    await createUser({ name: 'Asha Rao', email: 'asha@example.com', panNumber: 'ABCDE1234F' });
    await createUser({ companyName: 'Rao Devices', gstNumber: '22AAAAA0000A1Z5' });
    await createUser({ name: 'Unrelated', referralCode: 'ZZZ9999' });

    const byName = await asAdmin(token).get('/api/v1/admin/users?search=asha');
    expect(byName.body.data.items).toHaveLength(1);

    const byCompany = await asAdmin(token).get('/api/v1/admin/users?search=Rao');
    expect(byCompany.body.data.items).toHaveLength(2);

    const byPan = await asAdmin(token).get('/api/v1/admin/users?search=ABCDE1234F');
    expect(byPan.body.data.items).toHaveLength(1);

    const byGst = await asAdmin(token).get('/api/v1/admin/users?search=22AAAAA');
    expect(byGst.body.data.items).toHaveLength(1);

    const byCode = await asAdmin(token).get('/api/v1/admin/users?search=ZZZ9999');
    expect(byCode.body.data.items).toHaveLength(1);
  });

  it('treats regex metacharacters in a search term literally', async () => {
    const { token } = await createAdminToken();
    await createUser({ name: 'Asha' });

    const res = await asAdmin(token).get('/api/v1/admin/users?search=%2B91');

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(0);
  });

  it('filters by kycCompleted and userType', async () => {
    const { token } = await createAdminToken();
    await createUser({ kycCompleted: true, userType: 'vendor' });
    await createUser({ kycCompleted: false });

    const done = await asAdmin(token).get('/api/v1/admin/users?kycCompleted=true');
    expect(done.body.data.items).toHaveLength(1);

    const pending = await asAdmin(token).get('/api/v1/admin/users?kycCompleted=false');
    expect(pending.body.data.items).toHaveLength(1);

    const vendors = await asAdmin(token).get('/api/v1/admin/users?userType=vendor');
    expect(vendors.body.data.items).toHaveLength(1);
  });

  it('paginates', async () => {
    const { token } = await createAdminToken();
    await createUser();
    await createUser();
    await createUser();

    const res = await asAdmin(token).get('/api/v1/admin/users?page=2&limit=2');

    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.pagination).toMatchObject({ page: 2, limit: 2, total: 3, pages: 2 });
  });
});

describe('GET /admin/users/:userId', () => {
  it('422s on a malformed user id', async () => {
    const { token } = await createAdminToken();
    const res = await asAdmin(token).get('/api/v1/admin/users/not-an-id');
    expect(res.status).toBe(422);
  });

  it('404s for a user that does not exist', async () => {
    const { token } = await createAdminToken();
    const res = await asAdmin(token).get('/api/v1/admin/users/507f1f77bcf86cd799439011');
    expect(res.status).toBe(404);
  });

  it('returns the full profile, KYC, wallet and referral picture', async () => {
    const { token } = await createAdminToken();
    const { user } = await createFundedUser(300, {
      name: 'Asha Rao', kycCompleted: true, userType: 'individual',
      panNumber: 'ABCDE1234F', referralCode: 'ASHA001', aadhaarVerified: true,
    });

    const res = await asAdmin(token).get(`/api/v1/admin/users/${user._id}`);

    expect(res.status).toBe(200);
    const { data } = res.body;

    expect(data.user.id).toBe(user._id.toString());
    expect(data.user.mobile).toBe(user.mobile);
    expect(data.kyc.completed).toBe(true);
    expect(data.kyc.userType).toBe('individual');
    expect(data.kyc.panNumber).toBe('ABCDE1234F');
    expect(data.kyc.aadhaarVerified).toBe(true);
    expect(data.wallet.balance).toBe(300);
    expect(data.referral.referralCode).toBe('ASHA001');
    expect(data.account.status).toBe('ACTIVE');
  });

  it('lists the recent IMEI checks with their device details', async () => {
    const { token } = await createAdminToken();
    const { user } = await createUser();

    await ImeiVerificationLog.create({
      userId: user._id, imei1: '111111111111111', imei2: '222222222222222',
      deviceModel: 'Galaxy S23', imei1Status: 'CLEAN', allowTransaction: true,
      referenceId: 'ref-admin-1', verifiedAt: new Date(),
      rawResponse: { bulky: 'should-not-be-returned' },
    });

    const res = await asAdmin(token).get(`/api/v1/admin/users/${user._id}`);
    const [check] = res.body.data.recent.imeiChecks;

    expect(res.body.data.activity.imeiChecks.total).toBe(1);
    expect(check.imei1).toBe('111111111111111');
    expect(check.imei2).toBe('222222222222222');
    expect(check.deviceModel).toBe('Galaxy S23');
    expect(check.imei1Status).toBe('CLEAN');
    expect(check.allowTransaction).toBe(true);
    // rawResponse is bulky and deliberately excluded.
    expect(check.rawResponse).toBeUndefined();
  });

  it('reports tokens spent net of refunds, from the ledger', async () => {
    const { token } = await createAdminToken();
    const { user } = await createFundedUser(1000);

    // Two checks charged, one of them refunded because CEIR gave no answer.
    await walletService.debit(user._id, 20, {
      reason: TXN_REASON.FEATURE_CHARGE, referenceType: TXN_REF_TYPE.IVS_CHECK,
      idempotencyKey: 'chk-1:charge',
    });
    await walletService.debit(user._id, 20, {
      reason: TXN_REASON.FEATURE_CHARGE, referenceType: TXN_REF_TYPE.IVS_CHECK,
      idempotencyKey: 'chk-2:charge',
    });
    await walletService.credit(user._id, 20, {
      reason: TXN_REASON.REFUND, referenceType: TXN_REF_TYPE.IVS_CHECK,
      idempotencyKey: 'chk-2:refund',
    });

    const res = await asAdmin(token).get(`/api/v1/admin/users/${user._id}`);

    expect(res.body.data.activity.imeiChecks.tokensSpent).toBe(20);
    expect(res.body.data.wallet.balance).toBe(980);
    expect(res.body.data.recent.transactions).toHaveLength(3);
  });

  it('shows top-up orders and counts only the paid ones', async () => {
    const { token } = await createAdminToken();
    const { user } = await createUser();

    await Payment.create([
      { userId: user._id, razorpayOrderId: 'order_a', amountPaise: 50000, tokens: 500, status: 'PAID' },
      { userId: user._id, razorpayOrderId: 'order_b', amountPaise: 10000, tokens: 100, status: 'FAILED' },
    ]);

    const res = await asAdmin(token).get(`/api/v1/admin/users/${user._id}`);

    expect(res.body.data.activity.payments.totalPaid).toBe(1);
    expect(res.body.data.activity.payments.amountInr).toBe(500);
    // The recent block shows every order, paid or not, for support purposes.
    expect(res.body.data.recent.payments).toHaveLength(2);
  });

  it("never mixes in another user's records", async () => {
    const { token } = await createAdminToken();
    const { user } = await createUser();
    const { user: other } = await createUser();

    await ImeiVerificationLog.create({
      userId: other._id, imei1: '333333333333333', imei1Status: 'CLEAN',
      allowTransaction: true, referenceId: 'ref-other', verifiedAt: new Date(),
    });
    await Payment.create({
      userId: other._id, razorpayOrderId: 'order_other', amountPaise: 10000,
      tokens: 100, status: 'PAID',
    });

    const res = await asAdmin(token).get(`/api/v1/admin/users/${user._id}`);

    expect(res.body.data.recent.imeiChecks).toHaveLength(0);
    expect(res.body.data.recent.payments).toHaveLength(0);
    expect(res.body.data.activity.imeiChecks.total).toBe(0);
  });

  it('never leaks the internal profile image id', async () => {
    const { token } = await createAdminToken();
    const { user } = await createUser();
    await User.findByIdAndUpdate(user._id, { profileImagePublicId: 'users/secret-id' });

    const res = await asAdmin(token).get(`/api/v1/admin/users/${user._id}`);

    expect(JSON.stringify(res.body)).not.toContain('secret-id');
  });
});
