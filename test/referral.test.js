const { createUser, asUser, balanceOf } = require('./helpers/factory');
const { stubCreateOrder, checkoutSignature } = require('./helpers/razorpay');
const User = require('../src/models/User.model');
const Referral = require('../src/models/Referral.model');
const referralService = require('../src/services/referral.service');
const PRICING = require('../src/constants/pricing');
const { REFERRAL_STATUS } = require('../src/constants/walletEnums');

/**
 * The referral reward is the only bonus in the system (SIGNUP_BONUS is 0), and
 * it pays on the referred user's FIRST successful top-up — not at signup. These
 * cover the payout itself, which the wallet spec only touched at the edges.
 */

/**
 * A real, correctly signed top-up driven through the API, so the referral payout
 * runs exactly as it does in production rather than being invoked directly.
 */
const topUp = async (token, amountInr, orderId) => {
  stubCreateOrder(orderId);
  await asUser(token).post('/api/v1/wallet/topup/order').send({ amount: amountInr });

  const paymentId = `pay_${orderId}`;
  return asUser(token)
    .post('/api/v1/wallet/topup/verify')
    .send({ orderId, paymentId, signature: checkoutSignature(orderId, paymentId) });
};

describe('referral capture at signup', () => {
  it('binds the referee to the referrer', async () => {
    const { user: referrer } = await createUser({ referralCode: 'REF1234' });
    const { user: referee } = await createUser();

    await referralService.captureReferral(referee, 'REF1234');

    const referral = await Referral.findOne({ refereeId: referee._id });
    expect(String(referral.referrerId)).toBe(String(referrer._id));
    expect(referral.status).toBe(REFERRAL_STATUS.PENDING);

    const after = await User.findById(referee._id);
    expect(String(after.referredBy)).toBe(String(referrer._id));
  });

  it('pays nobody at signup — the reward waits for a top-up', async () => {
    const { user: referrer } = await createUser({ referralCode: 'REF1234' });
    const { user: referee } = await createUser();

    await referralService.captureReferral(referee, 'REF1234');

    expect(await balanceOf(referrer._id)).toBe(0);
    expect(await balanceOf(referee._id)).toBe(0);
  });

  it('is case-insensitive about the code', async () => {
    await createUser({ referralCode: 'REF1234' });
    const { user: referee } = await createUser();

    await referralService.captureReferral(referee, 'ref1234');

    expect(await Referral.findOne({ refereeId: referee._id })).toBeTruthy();
  });

  it('ignores an unknown code rather than blocking signup', async () => {
    const { user: referee } = await createUser();

    const result = await referralService.captureReferral(referee, 'NOSUCH1');

    expect(result).toBeNull();
    expect(await Referral.countDocuments({})).toBe(0);
  });

  it('ignores a self-referral', async () => {
    const { user } = await createUser({ referralCode: 'SELF123' });

    const result = await referralService.captureReferral(user, 'SELF123');

    expect(result).toBeNull();
    expect(await Referral.countDocuments({})).toBe(0);
  });

  it('binds a referee once — a second code is ignored', async () => {
    await createUser({ referralCode: 'REF1234' });
    await createUser({ referralCode: 'OTHER12' });
    const { user: referee } = await createUser();

    await referralService.captureReferral(referee, 'REF1234');
    await referralService.captureReferral(referee, 'OTHER12');

    expect(await Referral.countDocuments({ refereeId: referee._id })).toBe(1);
  });
});

describe('referral reward on the first top-up', () => {
  it('pays both sides when the referred user first tops up', async () => {
    const { user: referrer } = await createUser({ referralCode: 'REF1234' });
    const { user: referee, token: refereeToken } = await createUser();
    await referralService.captureReferral(referee, 'REF1234');

    await topUp(refereeToken, 100, 'order_ref_1');

    expect(await balanceOf(referrer._id)).toBe(PRICING.REFERRAL.REFERRER_BONUS);
    // The referee gets their purchased tokens plus the welcome bonus.
    expect(await balanceOf(referee._id)).toBe(100 + PRICING.REFERRAL.REFEREE_WELCOME);

    const referral = await Referral.findOne({ refereeId: referee._id });
    expect(referral.status).toBe(REFERRAL_STATUS.REWARDED);
    expect(referral.rewardedAt).toBeTruthy();
    expect(referral.referrerRewardTxnId).toBeTruthy();
    expect(referral.refereeRewardTxnId).toBeTruthy();
  });

  it('pays only once — a second top-up earns no further bonus', async () => {
    const { user: referrer } = await createUser({ referralCode: 'REF1234' });
    const { user: referee, token: refereeToken } = await createUser();
    await referralService.captureReferral(referee, 'REF1234');

    await topUp(refereeToken, 100, 'order_ref_1');
    await topUp(refereeToken, 100, 'order_ref_2');

    expect(await balanceOf(referrer._id)).toBe(PRICING.REFERRAL.REFERRER_BONUS);
    expect(await balanceOf(referee._id)).toBe(200 + PRICING.REFERRAL.REFEREE_WELCOME);
  });

  it('pays nothing when the user was never referred', async () => {
    const { user, token } = await createUser();

    await topUp(token, 100, 'order_ref_3');

    expect(await balanceOf(user._id)).toBe(100);
  });

  it('counts a referrer with several referees once each', async () => {
    const { user: referrer } = await createUser({ referralCode: 'REF1234' });

    const { user: a, token: tokenA } = await createUser();
    const { user: b, token: tokenB } = await createUser();
    await referralService.captureReferral(a, 'REF1234');
    await referralService.captureReferral(b, 'REF1234');

    await topUp(tokenA, 100, 'order_ref_a');
    await topUp(tokenB, 100, 'order_ref_b');

    expect(await balanceOf(referrer._id)).toBe(PRICING.REFERRAL.REFERRER_BONUS * 2);
  });
});

describe('GET /referral', () => {
  it('reports the code, counts and the reward amounts', async () => {
    const { user: referrer, token } = await createUser({ referralCode: 'REF1234' });
    const { user: referee, token: refereeToken } = await createUser();
    await referralService.captureReferral(referee, 'REF1234');

    const pending = await asUser(token).get('/api/v1/referral');
    expect(pending.body.data.totalReferred).toBe(1);
    expect(pending.body.data.totalRewarded).toBe(0);
    expect(pending.body.data.rewardPerReferral).toBe(PRICING.REFERRAL.REFERRER_BONUS);
    expect(pending.body.data.welcomeBonus).toBe(PRICING.REFERRAL.REFEREE_WELCOME);

    await topUp(refereeToken, 100, 'order_ref_4');
    void referrer;

    const rewarded = await asUser(token).get('/api/v1/referral');
    expect(rewarded.body.data.totalRewarded).toBe(1);
  });
});
