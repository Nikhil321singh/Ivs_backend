const Wallet = require('../models/Wallet.model');
const WalletTransaction = require('../models/WalletTransaction.model');
const { TXN_TYPE, TXN_REASON } = require('../constants/walletEnums');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/* eslint-disable no-console */

/**
 * The wallet ledger. Two invariants make this safe for money:
 *
 *  1. Every balance change is an atomic single-document update on the Wallet
 *     (`$inc`), so concurrent requests can't lose updates. Debits use a
 *     conditional match (`balance >= amount`) so the balance can never go
 *     negative and two requests can't spend the same tokens.
 *
 *  2. Every change also writes exactly one immutable WalletTransaction row.
 *     Callers that can fire twice (webhooks, referral payouts) pass an
 *     `idempotencyKey`; the unique index guarantees the money moves once. If
 *     the ledger insert loses an idempotency race, we compensate the wallet
 *     $inc so balance and ledger stay consistent.
 *
 * NOTE: for the strongest guarantee (wallet update + ledger insert as one
 * atomic unit) run MongoDB as a replica set and wrap these in a session
 * transaction. The compensation approach below keeps a single-node deployment
 * correct without transactions.
 */

const getOrCreateWallet = async (userId) => {
  try {
    return await Wallet.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    // Two concurrent first-time requests raced to create the wallet.
    if (err.code === 11000) return Wallet.findOne({ userId });
    throw err;
  }
};

const getBalance = async (userId) => {
  const wallet = await getOrCreateWallet(userId);
  return wallet.balance;
};

const getWallet = (userId) => getOrCreateWallet(userId);

const statFieldForCredit = (reason) => {
  if (reason === TXN_REASON.TOPUP) return 'totalPurchased';
  if (reason === TXN_REASON.REFERRAL_BONUS || reason === TXN_REASON.WELCOME_BONUS) return 'totalBonus';
  return null;
};

const findByIdempotencyKey = (idempotencyKey) =>
  (idempotencyKey ? WalletTransaction.findOne({ idempotencyKey }) : Promise.resolve(null));

/**
 * Add tokens to a wallet. Idempotent when `idempotencyKey` is supplied.
 */
const credit = async (
  userId,
  amount,
  { reason, referenceType = null, referenceId = null, idempotencyKey = null, metadata = null }
) => {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.WALLET.INVALID_AMOUNT);
  }

  const existing = await findByIdempotencyKey(idempotencyKey);
  if (existing) return existing;

  await getOrCreateWallet(userId);

  const inc = { balance: amount };
  const statField = statFieldForCredit(reason);
  if (statField) inc[statField] = amount;

  const wallet = await Wallet.findOneAndUpdate({ userId }, { $inc: inc }, { new: true });
  const balanceAfter = wallet.balance;
  const balanceBefore = balanceAfter - amount;

  try {
    return await WalletTransaction.create({
      walletId: wallet._id,
      userId,
      type: TXN_TYPE.CREDIT,
      reason,
      amount,
      balanceBefore,
      balanceAfter,
      referenceType,
      referenceId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      metadata,
    });
  } catch (err) {
    if (err.code === 11000 && idempotencyKey) {
      // A concurrent request already credited under this key — undo our $inc.
      const undo = { balance: -amount };
      if (statField) undo[statField] = -amount;
      await Wallet.updateOne({ userId }, { $inc: undo });
      return WalletTransaction.findOne({ idempotencyKey });
    }
    throw err;
  }
};

/**
 * Deduct tokens. Throws 402 if the wallet can't cover it. Atomic conditional
 * decrement prevents double-spend and negative balances.
 */
const debit = async (
  userId,
  amount,
  { reason = TXN_REASON.FEATURE_CHARGE, referenceType = null, referenceId = null, idempotencyKey = null, metadata = null }
) => {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.WALLET.INVALID_AMOUNT);
  }

  const existing = await findByIdempotencyKey(idempotencyKey);
  if (existing) return existing;

  await getOrCreateWallet(userId);

  const wallet = await Wallet.findOneAndUpdate(
    { userId, balance: { $gte: amount } },
    { $inc: { balance: -amount, totalSpent: amount } },
    { new: true }
  );

  if (!wallet) {
    throw new ApiError(httpStatus.PAYMENT_REQUIRED, MESSAGES.WALLET.INSUFFICIENT_BALANCE);
  }

  const balanceAfter = wallet.balance;
  const balanceBefore = balanceAfter + amount;

  try {
    return await WalletTransaction.create({
      walletId: wallet._id,
      userId,
      type: TXN_TYPE.DEBIT,
      reason,
      amount,
      balanceBefore,
      balanceAfter,
      referenceType,
      referenceId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      metadata,
    });
  } catch (err) {
    // Ledger write failed after we already decremented — refund so the
    // balance never silently drifts below the ledger.
    await Wallet.updateOne({ userId }, { $inc: { balance: amount, totalSpent: -amount } });
    if (err.code === 11000 && idempotencyKey) {
      return WalletTransaction.findOne({ idempotencyKey });
    }
    throw err;
  }
};

const getStatement = async (userId, { page = 1, limit = 20 } = {}) => {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(100, Math.max(1, limit));
  const skip = (safePage - 1) * safeLimit;

  const [items, total] = await Promise.all([
    WalletTransaction.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
    WalletTransaction.countDocuments({ userId }),
  ]);

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
    },
  };
};

module.exports = {
  getOrCreateWallet,
  getWallet,
  getBalance,
  credit,
  debit,
  getStatement,
};
