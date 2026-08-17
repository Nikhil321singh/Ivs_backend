const { createUser, asUser, balanceOf } = require('./helpers/factory');
const User = require('../src/models/User.model');
const userService = require('../src/services/user.service');
const walletService = require('../src/services/wallet.service');
const { hashAadhaar } = require('../src/utils/hash.util');
const PRICING = require('../src/constants/pricing');
const settings = require('../src/services/settings.service');

const individualKyc = {
  userType: 'individual', name: 'Asha Rao', phone: '9876543210',
  email: 'asha@example.com', panNumber: 'ABCDE1234F', aadhaarNumber: '234567890123',
};

/** A user whose Aadhaar is already verified, so complete-kyc can succeed. */
const kycReadyUser = async () => {
  const created = await createUser();
  await User.findByIdAndUpdate(created.user._id, {
    aadhaarVerified: true,
    aadhaarNumberHash: hashAadhaar('234567890123', created.user._id),
  });
  return created;
};

describe('joining bonus', () => {
  it('is NOT granted when a new account is created at first login', async () => {
    const { user, isNewUser } = await userService.findOrCreateUserByMobile('+91', '9998887771');

    expect(isNewUser).toBe(true);
    expect(await balanceOf(user._id)).toBe(0);
  });

  it('is granted when the user completes KYC', async () => {
    const { user, token } = await kycReadyUser();
    expect(await balanceOf(user._id)).toBe(0);

    const res = await asUser(token).post('/api/v1/user/complete-kyc').send(individualKyc);

    expect(res.status).toBe(200);
    expect(await balanceOf(user._id)).toBe(PRICING.SIGNUP_BONUS);
  });

  it('counts toward totalBonus, not totalPurchased', async () => {
    const { user, token } = await kycReadyUser();
    await asUser(token).post('/api/v1/user/complete-kyc').send(individualKyc);

    const wallet = await walletService.getWallet(user._id);
    expect(wallet.totalBonus).toBe(PRICING.SIGNUP_BONUS);
    expect(wallet.totalPurchased).toBe(0);
  });

  it('writes one SIGNUP_BONUS ledger row the user can see', async () => {
    const { token } = await kycReadyUser();
    await asUser(token).post('/api/v1/user/complete-kyc').send(individualKyc);

    const res = await asUser(token).get('/api/v1/user/me');
    expect(res.body.data.wallet.balance).toBe(PRICING.SIGNUP_BONUS);
    expect(res.body.data.wallet.totalBonus).toBe(PRICING.SIGNUP_BONUS);
  });

  it('never pays twice — an account already paid at signup is not paid again', async () => {
    const { user, token } = await kycReadyUser();

    // Simulates an account credited by the old signup-time grant, which used
    // this same idempotency key.
    await walletService.credit(user._id, PRICING.SIGNUP_BONUS, {
      reason: 'SIGNUP_BONUS',
      idempotencyKey: `signup-bonus-${user._id}`,
    });
    expect(await balanceOf(user._id)).toBe(PRICING.SIGNUP_BONUS);

    await asUser(token).post('/api/v1/user/complete-kyc').send(individualKyc);

    expect(await balanceOf(user._id)).toBe(PRICING.SIGNUP_BONUS);
  });

  it('is not granted twice if complete-kyc is somehow called again', async () => {
    const { user, token } = await kycReadyUser();
    await asUser(token).post('/api/v1/user/complete-kyc').send(individualKyc);

    // Second call 409s (KYC already complete) and must not pay again.
    const again = await asUser(token).post('/api/v1/user/complete-kyc').send(individualKyc);
    expect(again.status).toBe(409);
    expect(await balanceOf(user._id)).toBe(PRICING.SIGNUP_BONUS);
  });

  it('is NOT granted when the user skips KYC', async () => {
    await settings.update({ kycRequired: false });
    const { user, token } = await createUser();

    const res = await asUser(token).post('/api/v1/user/skip-kyc');

    expect(res.status).toBe(200);
    expect(await balanceOf(user._id)).toBe(0);
  });

  it('is advertised on GET /pricing so the app can show the offer', async () => {
    const { token } = await createUser();
    const res = await asUser(token).get('/api/v1/pricing');

    expect(res.body.data.signupBonus).toBe(PRICING.SIGNUP_BONUS);
  });
});
