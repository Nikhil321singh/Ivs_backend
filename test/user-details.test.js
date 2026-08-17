const { createUser, createFundedUser, asUser, request, app } = require('./helpers/factory');
const User = require('../src/models/User.model');
const Wallet = require('../src/models/Wallet.model');
const Payment = require('../src/models/Payment.model');
const Referral = require('../src/models/Referral.model');
const ImeiVerificationLog = require('../src/models/ImeiVerificationLog.model');
const walletService = require('../src/services/wallet.service');
const { TXN_REASON, TXN_REF_TYPE } = require('../src/constants/walletEnums');
const settings = require('../src/services/settings.service');

describe('GET /user/me', () => {
  it('rejects an unauthenticated caller', async () => {
    const res = await request(app).get('/api/v1/user/me');
    expect(res.status).toBe(401);
  });

  it('returns every section for a brand-new user', async () => {
    const { user, token } = await createUser({ referralCode: 'NEWUSR1' });

    const res = await asUser(token).get('/api/v1/user/me');

    expect(res.status).toBe(200);
    const { data } = res.body;

    expect(data.user.id).toBe(user._id.toString());
    expect(data.user.mobile).toBe(user.mobile);
    expect(data.kyc.completed).toBe(false);
    expect(data.referral.referralCode).toBe('NEWUSR1');
    expect(data.referral.referredBy).toBeNull();
    expect(data.activity.imeiChecks.total).toBe(0);
    expect(data.activity.payments.totalPaid).toBe(0);
    expect(data.account.status).toBe('ACTIVE');
    expect(data.account.isMobileVerified).toBe(true);
  });

  it('never provisions a wallet just by being read', async () => {
    const { user, token } = await createUser();

    const res = await asUser(token).get('/api/v1/user/me');

    expect(res.body.data.wallet).toEqual({
      balance: 0,
      totalPurchased: 0,
      totalBonus: 0,
      totalSpent: 0,
    });
    expect(await Wallet.findOne({ userId: user._id })).toBeNull();
  });

  it('reports the wallet, IMEI and payment totals of an active user', async () => {
    const { user, token } = await createFundedUser(538);

    await ImeiVerificationLog.create([
      {
        userId: user._id, imei1: '111111111111111', imei1Status: 'CLEAN',
        allowTransaction: true, referenceId: 'ref-me-1', verifiedAt: new Date(),
      },
      {
        userId: user._id, imei1: '222222222222222', imei1Status: 'BLOCKED',
        allowTransaction: false, referenceId: 'ref-me-2', verifiedAt: new Date(),
      },
    ]);

    // tokensSpent comes from the ledger, not from counting log rows — see
    // netSpendByFeature in user.service.js.
    await walletService.debit(user._id, 19, {
      reason: TXN_REASON.FEATURE_CHARGE, referenceType: TXN_REF_TYPE.IVS_CHECK,
      idempotencyKey: 'me-chk-1:charge',
    });
    await walletService.debit(user._id, 19, {
      reason: TXN_REASON.FEATURE_CHARGE, referenceType: TXN_REF_TYPE.IVS_CHECK,
      idempotencyKey: 'me-chk-2:charge',
    });

    await Payment.create({
      userId: user._id, razorpayOrderId: 'order_me_1', amountPaise: 40000,
      tokens: 400, status: 'PAID',
    });

    // Lifetime credit stats are set after the debits so the two $inc paths
    // don't fight over the same fields.
    await Wallet.updateOne({ userId: user._id }, { totalPurchased: 400, totalBonus: 100 });

    const res = await asUser(token).get('/api/v1/user/me');

    expect(res.status).toBe(200);
    const { wallet, activity } = res.body.data;

    expect(wallet).toEqual({
      balance: 500, totalPurchased: 400, totalBonus: 100, totalSpent: 38,
    });
    expect(activity.imeiChecks.total).toBe(2);
    expect(activity.imeiChecks.allowed).toBe(1);
    expect(activity.imeiChecks.blocked).toBe(1);
    expect(activity.imeiChecks.tokensSpent).toBe(38);
    expect(activity.imeiChecks.lastAt).not.toBeNull();
    expect(activity.payments.totalPaid).toBe(1);
    expect(activity.payments.amountInr).toBe(400);
    expect(activity.payments.tokensPurchased).toBe(400);
  });

  it('counts only PAID payments', async () => {
    const { user, token } = await createUser();
    await Payment.create([
      { userId: user._id, razorpayOrderId: 'order_pend', amountPaise: 10000, tokens: 100, status: 'CREATED' },
      { userId: user._id, razorpayOrderId: 'order_fail', amountPaise: 10000, tokens: 100, status: 'FAILED' },
    ]);

    const res = await asUser(token).get('/api/v1/user/me');

    expect(res.body.data.activity.payments.totalPaid).toBe(0);
    expect(res.body.data.activity.payments.amountPaise).toBe(0);
  });

  it('never counts another user\'s activity', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser();
    await ImeiVerificationLog.create({
      userId: other._id, imei1: '333333333333333', imei1Status: 'CLEAN',
      allowTransaction: true, cost: 19, referenceId: 'ref-other-1', verifiedAt: new Date(),
    });

    const res = await asUser(token).get('/api/v1/user/me');

    expect(res.body.data.activity.imeiChecks.total).toBe(0);
  });

  it('includes referral counts and who referred this user', async () => {
    const { user: referrer } = await createUser({ referralCode: 'REFRR01' });
    const { user, token } = await createUser({ referredBy: referrer._id, name: 'Referee' });

    await Referral.create({ referrerId: user._id, refereeId: referrer._id, code: 'X', status: 'REWARDED' });

    const res = await asUser(token).get('/api/v1/user/me');
    const { referral } = res.body.data;

    expect(referral.totalReferred).toBe(1);
    expect(referral.totalRewarded).toBe(1);
    expect(referral.referredBy.id).toBe(referrer._id.toString());
    expect(referral.referredBy.referralCode).toBe('REFRR01');
  });

  it('exposes KYC state and whether KYC can be skipped', async () => {
    await settings.update({ kycRequired: false });
    const { token } = await createUser();

    let res = await asUser(token).get('/api/v1/user/me');
    expect(res.body.data.kyc.kycRequired).toBe(false);
    expect(res.body.data.kyc.canSkipKyc).toBe(true);

    await settings.update({ kycRequired: true });
    res = await asUser(token).get('/api/v1/user/me');
    expect(res.body.data.kyc.kycRequired).toBe(true);
    expect(res.body.data.kyc.canSkipKyc).toBe(false);
  });

  it('reports KYC fields once KYC is complete', async () => {
    const { user, token } = await createUser();
    await User.findByIdAndUpdate(user._id, {
      kycCompleted: true, userType: 'vendor', isGstRegistered: true,
      gstNumber: '22AAAAA0000A1Z5', panNumber: 'ABCDE1234F', companyName: 'Rao Devices',
    });

    const res = await asUser(token).get('/api/v1/user/me');
    const { kyc } = res.body.data;

    expect(kyc.completed).toBe(true);
    expect(kyc.userType).toBe('vendor');
    expect(kyc.gstNumber).toBe('22AAAAA0000A1Z5');
    expect(kyc.panNumber).toBe('ABCDE1234F');
    expect(kyc.canSkipKyc).toBe(false);
  });

  it('never leaks the internal profile image id', async () => {
    const { user, token } = await createUser();
    await User.findByIdAndUpdate(user._id, {
      profileImage: 'https://cdn.test/x.jpg', profileImagePublicId: 'users/secret-id',
    });

    const res = await asUser(token).get('/api/v1/user/me');

    expect(res.body.data.user.profileImage).toBe('https://cdn.test/x.jpg');
    expect(JSON.stringify(res.body)).not.toContain('secret-id');
    expect(res.body.data.user.profileImagePublicId).toBeUndefined();
  });
});
