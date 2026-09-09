const Entitlement = require('../models/Entitlement.model');
const EntitlementTransaction = require('../models/EntitlementTransaction.model');
const PRICING = require('../constants/pricing');
const {
  ENTITLEMENT_TXN_TYPE,
  ENTITLEMENT_REASON,
} = require('../constants/entitlementEnums');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/**
 * The credit ledger. Deliberately the same shape as wallet.service.js, because
 * the two invariants that make that safe for money make this safe for credits:
 *
 *  1. Every counter change is an atomic single-document update on the
 *     Entitlement (`$inc`), so concurrent requests can't lose updates.
 *     Consumption uses a conditional match (`credits.FEATURE >= amount`) so a
 *     counter can never go negative and two requests can't spend the same
 *     credit.
 *
 *  2. Every change also writes exactly one immutable EntitlementTransaction
 *     row. Callers that can fire twice (webhooks, retries) pass an
 *     `idempotencyKey`; the unique index guarantees the credit moves once. If
 *     the ledger insert loses an idempotency race, we compensate the `$inc` so
 *     counters and ledger stay consistent.
 *
 * Counters live in a Map, so every path here is built from a feature key. That
 * key is validated against the compiled-in feature registry before it is
 * interpolated — it must never be possible to address an arbitrary field.
 */

const FEATURE_KEYS = Object.freeze(Object.keys(PRICING.FEATURES));

const isKnownFeature = (feature) => FEATURE_KEYS.includes(feature);

const assertFeature = (feature) => {
  if (!isKnownFeature(feature)) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.ENTITLEMENT.INVALID_FEATURE);
  }
};

/** Mongoose Map → plain object, with every known feature present as a number. */
const toCreditMap = (map) =>
  Object.fromEntries(FEATURE_KEYS.map((key) => [key, map?.get?.(key) ?? 0]));

const getOrCreate = async (userId) => {
  try {
    return await Entitlement.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    // Two concurrent first-time requests raced to create the document.
    if (err.code === 11000) return Entitlement.findOne({ userId });
    throw err;
  }
};

/** Spendable credits for one feature. */
const getCredits = async (userId, feature) => {
  assertFeature(feature);
  const entitlement = await getOrCreate(userId);
  return entitlement.credits?.get(feature) ?? 0;
};

/** Everything the customer's "my credits" screen needs. */
const getSummary = async (userId) => {
  const entitlement = await getOrCreate(userId);

  return {
    credits: toCreditMap(entitlement.credits),
    totalPurchased: toCreditMap(entitlement.totalPurchased),
    totalUsed: toCreditMap(entitlement.totalUsed),
    updatedAt: entitlement.updatedAt,
  };
};

const findByIdempotencyKey = (idempotencyKey) =>
  (idempotencyKey ? EntitlementTransaction.findOne({ idempotencyKey }) : Promise.resolve(null));

/**
 * Grant credits for one feature. Idempotent when `idempotencyKey` is supplied.
 *
 * `countsAsPurchase` drives the lifetime stat: a paid pack increments
 * totalPurchased, an admin grant or refund does not.
 */
const credit = async (
  userId,
  feature,
  amount,
  {
    reason = ENTITLEMENT_REASON.PLAN_PURCHASE,
    referenceType = null,
    referenceId = null,
    idempotencyKey = null,
    adminId = null,
    note = null,
    metadata = null,
    countsAsPurchase = true,
  } = {}
) => {
  assertFeature(feature);

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.ENTITLEMENT.INVALID_AMOUNT);
  }

  const existing = await findByIdempotencyKey(idempotencyKey);
  if (existing) return existing;

  await getOrCreate(userId);

  const inc = { [`credits.${feature}`]: amount };
  if (countsAsPurchase) inc[`totalPurchased.${feature}`] = amount;

  const entitlement = await Entitlement.findOneAndUpdate({ userId }, { $inc: inc }, { new: true });
  const balanceAfter = entitlement.credits.get(feature);
  const balanceBefore = balanceAfter - amount;

  try {
    return await EntitlementTransaction.create({
      entitlementId: entitlement._id,
      userId,
      type: ENTITLEMENT_TXN_TYPE.CREDIT,
      feature,
      amount,
      balanceBefore,
      balanceAfter,
      reason,
      referenceType,
      referenceId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      adminId,
      note,
      metadata,
    });
  } catch (err) {
    if (err.code === 11000 && idempotencyKey) {
      // A concurrent request already credited under this key — undo our $inc.
      const undo = { [`credits.${feature}`]: -amount };
      if (countsAsPurchase) undo[`totalPurchased.${feature}`] = -amount;
      await Entitlement.updateOne({ userId }, { $inc: undo });
      return EntitlementTransaction.findOne({ idempotencyKey });
    }
    throw err;
  }
};

/**
 * Grant every feature in a pack's quota map. One self-contained credit() per
 * feature, each individually atomic and individually idempotent (the supplied
 * key is suffixed per feature), so a partial failure leaves the ledger and the
 * counters agreeing on exactly what was granted.
 *
 * Quantities of zero are skipped rather than written as no-op ledger rows.
 */
const creditPack = async (userId, quotas, { idempotencyKey = null, ...options } = {}) => {
  const entries = Object.entries(quotas || {}).filter(([, qty]) => Number(qty) > 0);

  const rows = [];
  for (const [feature, qty] of entries) {
    // Sequential on purpose: two credits to the same document should not race
    // each other, and a pack is two or three features at most.
    // eslint-disable-next-line no-await-in-loop
    const row = await credit(userId, feature, Number(qty), {
      ...options,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:${feature}` : null,
    });
    rows.push(row);
  }

  return rows;
};

/**
 * Spend one credit (or `amount`) on a feature. Throws 402 when the customer has
 * none left. The atomic conditional decrement prevents double-spend and
 * negative counters.
 */
const consume = async (
  userId,
  feature,
  {
    amount = 1,
    reason = ENTITLEMENT_REASON.FEATURE_USE,
    referenceType = null,
    referenceId = null,
    idempotencyKey = null,
    metadata = null,
  } = {}
) => {
  assertFeature(feature);

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.ENTITLEMENT.INVALID_AMOUNT);
  }

  const existing = await findByIdempotencyKey(idempotencyKey);
  if (existing) return existing;

  await getOrCreate(userId);

  const entitlement = await Entitlement.findOneAndUpdate(
    { userId, [`credits.${feature}`]: { $gte: amount } },
    { $inc: { [`credits.${feature}`]: -amount, [`totalUsed.${feature}`]: amount } },
    { new: true }
  );

  if (!entitlement) {
    throw new ApiError(httpStatus.PAYMENT_REQUIRED, MESSAGES.ENTITLEMENT.NO_CREDITS);
  }

  const balanceAfter = entitlement.credits.get(feature);
  const balanceBefore = balanceAfter + amount;

  try {
    return await EntitlementTransaction.create({
      entitlementId: entitlement._id,
      userId,
      type: ENTITLEMENT_TXN_TYPE.DEBIT,
      feature,
      amount,
      balanceBefore,
      balanceAfter,
      reason,
      referenceType,
      referenceId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      metadata,
    });
  } catch (err) {
    // Ledger write failed after we already decremented — give the credit back
    // so the counter never silently drifts below the ledger.
    await Entitlement.updateOne(
      { userId },
      { $inc: { [`credits.${feature}`]: amount, [`totalUsed.${feature}`]: -amount } }
    );
    if (err.code === 11000 && idempotencyKey) {
      return EntitlementTransaction.findOne({ idempotencyKey });
    }
    throw err;
  }
};

/**
 * Manual portal grant or deduction. Never writes the counter directly — it goes
 * through the same paths as a purchase or a consumption, so a counter can never
 * move without a ledger row explaining it. `adminId` and `note` are required by
 * the caller (see the admin validator): Admin has no role separation, so this
 * trail is the only control on an operator minting free credits.
 */
const adjust = async (userId, feature, delta, { adminId, note }) => {
  assertFeature(feature);

  if (!Number.isInteger(delta) || delta === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.ENTITLEMENT.INVALID_AMOUNT);
  }

  if (delta > 0) {
    return credit(userId, feature, delta, {
      reason: ENTITLEMENT_REASON.ADMIN_ADJUSTMENT,
      adminId,
      note,
      // A grant is not a purchase; keeping it out of totalPurchased means the
      // lifetime revenue stat stays honest.
      countsAsPurchase: false,
    });
  }

  return consume(userId, feature, {
    amount: -delta,
    reason: ENTITLEMENT_REASON.ADMIN_ADJUSTMENT,
    metadata: { adminId: String(adminId), note },
  });
};

const getLedger = async (userId, { page = 1, limit = 20, feature = null } = {}) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const filter = { userId };
  if (feature && isKnownFeature(feature)) filter.feature = feature;

  const [items, total] = await Promise.all([
    EntitlementTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
    EntitlementTransaction.countDocuments(filter),
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
  FEATURE_KEYS,
  isKnownFeature,
  getOrCreate,
  getCredits,
  getSummary,
  credit,
  creditPack,
  consume,
  adjust,
  getLedger,
};
