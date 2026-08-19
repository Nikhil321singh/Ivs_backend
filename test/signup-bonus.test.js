const { createUser, asUser, balanceOf } = require('./helpers/factory');
const Wallet = require('../src/models/Wallet.model');
const WalletTransaction = require('../src/models/WalletTransaction.model');
const userService = require('../src/services/user.service');
const PRICING = require('../src/constants/pricing');
const settings = require('../src/services/settings.service');

/**
 * SIGNUP_BONUS is 0, so no free tokens are granted anywhere — not at signup,
 * not on KYC completion, not on skip. The referral reward, paid on the referred
 * user's first successful top-up, is the only bonus in the system.
 *
 * These guard against the grant quietly coming back: grantSignupBonus is still
 * wired into completeKyc and returns early only because the constant is
 * non-positive, so a stray edit to pricing.js would start paying again.
 */
const kyc = { name: 'Asha Rao', email: 'asha@example.com', panNumber: 'ABCDE1234F' };

describe('joining bonus is switched off', () => {
  it('is configured as zero', () => {
    expect(PRICING.SIGNUP_BONUS).toBe(0);
  });

  it('grants nothing when a new account is created at first login', async () => {
    const { user, isNewUser } = await userService.findOrCreateUserByMobile('+91', '9998887771');

    expect(isNewUser).toBe(true);
    expect(await balanceOf(user._id)).toBe(0);
    // Not even a wallet: the grant returns before one is created.
    expect(await Wallet.findOne({ userId: user._id })).toBeNull();
  });

  it('grants nothing when the user completes KYC', async () => {
    const { user, token } = await createUser();

    const res = await asUser(token).post('/api/v1/user/complete-kyc').send(kyc);

    expect(res.status).toBe(200);
    expect(await balanceOf(user._id)).toBe(0);
  });

  it('writes no ledger row at all', async () => {
    const { user, token } = await createUser();

    await asUser(token).post('/api/v1/user/complete-kyc').send(kyc);

    // A zero-value credit would be rejected as an invalid amount, so the grant
    // must skip entirely rather than attempt one.
    expect(await WalletTransaction.countDocuments({ userId: user._id })).toBe(0);
  });

  it('grants nothing when the user skips KYC', async () => {
    await settings.update({ kycRequired: false });
    const { user, token } = await createUser();

    const res = await asUser(token).post('/api/v1/user/skip-kyc');

    expect(res.status).toBe(200);
    expect(await balanceOf(user._id)).toBe(0);
  });

  it('advertises zero on GET /pricing so no joining offer is shown', async () => {
    const { token } = await createUser();

    const res = await asUser(token).get('/api/v1/pricing');

    expect(res.body.data.signupBonus).toBe(0);
  });
});
