const walletService = require('../src/services/wallet.service');
const WalletTransaction = require('../src/models/WalletTransaction.model');
const { TXN_REASON } = require('../src/constants/walletEnums');
const { createUserWithToken } = require('./helpers/factories');

describe('Wallet ledger — credit', () => {
  it('credits tokens and records one ledger row', async () => {
    const { user } = await createUserWithToken();
    await walletService.credit(user._id, 100, { reason: TXN_REASON.TOPUP });

    expect(await walletService.getBalance(user._id)).toBe(100);
    expect(await WalletTransaction.countDocuments({ userId: user._id })).toBe(1);
  });

  it('is idempotent under the same idempotencyKey', async () => {
    const { user } = await createUserWithToken();
    const opts = { reason: TXN_REASON.TOPUP, idempotencyKey: 'same-key' };

    await walletService.credit(user._id, 100, opts);
    await walletService.credit(user._id, 100, opts);

    expect(await walletService.getBalance(user._id)).toBe(100);
    expect(await WalletTransaction.countDocuments({ userId: user._id })).toBe(1);
  });

  it('credits once under a concurrent race on the same key', async () => {
    const { user } = await createUserWithToken();
    const opts = { reason: TXN_REASON.TOPUP, idempotencyKey: 'race-key' };

    await Promise.all([
      walletService.credit(user._id, 100, opts),
      walletService.credit(user._id, 100, opts),
      walletService.credit(user._id, 100, opts),
    ]);

    expect(await walletService.getBalance(user._id)).toBe(100);
    expect(await WalletTransaction.countDocuments({ userId: user._id })).toBe(1);
  });
});

describe('Wallet ledger — debit', () => {
  it('deducts tokens when the balance covers it', async () => {
    const { user } = await createUserWithToken();
    await walletService.credit(user._id, 100, { reason: TXN_REASON.TOPUP });

    await walletService.debit(user._id, 20, { reason: TXN_REASON.FEATURE_CHARGE });

    expect(await walletService.getBalance(user._id)).toBe(80);
  });

  it('throws 402 when the balance is insufficient', async () => {
    const { user } = await createUserWithToken();
    await walletService.credit(user._id, 10, { reason: TXN_REASON.TOPUP });

    await expect(
      walletService.debit(user._id, 50, { reason: TXN_REASON.FEATURE_CHARGE })
    ).rejects.toMatchObject({ statusCode: 402 });

    expect(await walletService.getBalance(user._id)).toBe(10);
  });

  it('never double-spends under concurrent debits (only what the balance allows succeeds)', async () => {
    const { user } = await createUserWithToken();
    await walletService.credit(user._id, 50, { reason: TXN_REASON.TOPUP });

    // Fire three 20-token debits at once against a 50-token balance: at most
    // two can succeed (40), the third must fail — balance must never go negative.
    const results = await Promise.allSettled([
      walletService.debit(user._id, 20, { reason: TXN_REASON.FEATURE_CHARGE }),
      walletService.debit(user._id, 20, { reason: TXN_REASON.FEATURE_CHARGE }),
      walletService.debit(user._id, 20, { reason: TXN_REASON.FEATURE_CHARGE }),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    expect(succeeded).toBe(2);
    const balance = await walletService.getBalance(user._id);
    expect(balance).toBe(10);
    expect(balance).toBeGreaterThanOrEqual(0);
  });
});
