const Plan = require('../models/Plan.model');
const settingsService = require('./settings.service');
const { SETTING_KEYS } = require('../constants/settings');
const { PLAN_TIER, PLAN_AUDIENCE } = require('../constants/entitlementEnums');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/**
 * Plan catalogue and the pricing maths behind it.
 *
 * A pack bundles several features into one price, so "the per-check rate" needs
 * an allocation rule. The rule is a **uniform discount ratio**: the pack's price
 * divided by what those same quantities would cost at list price. That ratio is
 * then applied to each feature's list price to get its effective rate.
 *
 *     ratio       = pricePaise / listTotal(quotas)
 *     rate(f)     = listPrice(f) * ratio
 *     discount %  = (1 - ratio) * 100
 *
 * One rule, applied everywhere, so the strikethrough MRP, the advertised
 * saving, and the custom-tier floor can never disagree with each other.
 *
 * The custom tier is priced off **Pro Max's ratio**, not off list price:
 *
 *     customRatio = proMaxRatio * (1 - customDiscount%)
 *
 * That is what keeps custom structurally the cheapest per check no matter how
 * the packs are repriced. Discounting off list instead would let a deeply
 * discounted Pro Max quietly undercut the volume tier — see validateLadder().
 */

const LIST_PRICE_KEYS = Object.freeze({
  IVS_CHECK: SETTING_KEYS.IVS_LIST_PRICE_PAISE,
  DIAGNOSE: SETTING_KEYS.DIAGNOSE_LIST_PRICE_PAISE,
});

/** Mongoose Map | plain object → plain object of positive integers. */
const toQuotaObject = (quotas) => {
  const source = quotas instanceof Map ? Object.fromEntries(quotas) : quotas || {};

  return Object.fromEntries(
    Object.entries(source)
      .map(([feature, qty]) => [feature, Math.trunc(Number(qty) || 0)])
      .filter(([, qty]) => qty > 0)
  );
};

const listPriceFor = (feature, settings) => {
  const key = LIST_PRICE_KEYS[feature];
  return key ? settings[key] ?? 0 : 0;
};

/** What these quantities would cost with no pack discount at all. */
const listTotalPaise = (quotas, settings) =>
  Object.entries(toQuotaObject(quotas)).reduce(
    (total, [feature, qty]) => total + qty * listPriceFor(feature, settings),
    0
  );

/**
 * The pack's discount ratio. A list total of zero (list prices not configured)
 * would make this a division by zero, so it degrades to 1 — "no measurable
 * discount" — rather than producing Infinity and poisoning every rate downstream.
 */
const ratioOf = (pricePaise, quotas, settings) => {
  const list = listTotalPaise(quotas, settings);
  if (list <= 0) return 1;
  return pricePaise / list;
};

/**
 * Everything the plan card renders, computed server-side so a pricing
 * experiment never needs an app release.
 */
const decorate = (plan, settings) => {
  const quotas = toQuotaObject(plan.quotas);
  const listTotal = listTotalPaise(quotas, settings);
  const ratio = ratioOf(plan.pricePaise, quotas, settings);
  const mrpPaise = plan.mrpPaise ?? listTotal;

  return {
    id: plan.id || plan._id,
    code: plan.code,
    name: plan.name,
    tier: plan.tier,
    quotas,
    pricePaise: plan.pricePaise,
    // Rupees alongside paise: every client renders ₹, and rounding it in three
    // different apps is how they end up disagreeing.
    priceInr: plan.pricePaise / 100,
    mrpPaise,
    mrpInr: mrpPaise / 100,
    savingPaise: Math.max(0, mrpPaise - plan.pricePaise),
    discountPercent: Math.round((1 - ratio) * 100),
    // Per-feature effective rate, for "₹14.25 per check" style copy.
    rates: Object.fromEntries(
      Object.keys(quotas).map((feature) => [
        feature,
        Math.round(listPriceFor(feature, settings) * ratio),
      ])
    ),
    badge: plan.badge,
    highlight: plan.highlight,
    sortOrder: plan.sortOrder,
    audience: plan.audience,
    validityDays: plan.validityDays,
    isActive: plan.isActive,
  };
};

/**
 * Pro Max's discount ratio — the anchor the custom tier is priced from.
 * Falls back to 1 (list price) when no active PRO_MAX plan exists, so a
 * misconfigured catalogue prices custom at 5% off list rather than crashing or
 * giving it away.
 */
const proMaxRatio = async (settings) => {
  const proMax = await Plan.findOne({ tier: PLAN_TIER.PRO_MAX, isActive: true }).lean();
  if (!proMax) return 1;
  return ratioOf(proMax.pricePaise, proMax.quotas, settings);
};

const customRatioFrom = (proMax, settings) =>
  proMax * (1 - (settings[SETTING_KEYS.CUSTOM_DISCOUNT_PERCENT] || 0) / 100);

/**
 * Custom price, rounded UP to a whole rupee. Packs are priced in clean rupees
 * and a computed price sitting at ₹4,731.47 looks broken next to them; rounding
 * up (never down) also means the rounding can never undercut the intended rate.
 */
const quotePaise = (quantities, ratio, settings) =>
  Math.ceil((listTotalPaise(quantities, settings) * ratio) / 100) * 100;

const customMinimums = (settings) => ({
  IVS_CHECK: settings[SETTING_KEYS.CUSTOM_MIN_IVS_CHECK],
  DIAGNOSE: settings[SETTING_KEYS.CUSTOM_MIN_DIAGNOSE],
});

/**
 * The custom tier descriptor the app needs to render the fourth card, without
 * the customer having to request a quote first.
 */
const customTierInfo = async (settings) => {
  const ratio = customRatioFrom(await proMaxRatio(settings), settings);
  const minimums = customMinimums(settings);

  return {
    tier: PLAN_TIER.CUSTOM,
    minimums,
    discountPercent: Math.round((1 - ratio) * 100),
    rates: Object.fromEntries(
      Object.keys(LIST_PRICE_KEYS).map((feature) => [
        feature,
        Math.round(listPriceFor(feature, settings) * ratio),
      ])
    ),
    // A worked example at the minimum, so the card can show a real starting
    // price rather than "from ₹?".
    startingAt: quotePaise(minimums, ratio, settings),
  };
};

/**
 * Price a customer-chosen quantity. Self-serve: the admin owns the rules
 * (minimums and discount), the customer owns the quantity.
 *
 * The client sends quantities and never a price — this is the only thing that
 * decides what a custom pack costs.
 */
const quoteCustom = async (quantities) => {
  const settings = await settingsService.getAll();
  const minimums = customMinimums(settings);

  const requested = Object.fromEntries(
    Object.keys(LIST_PRICE_KEYS).map((feature) => [
      feature,
      Math.trunc(Number(quantities?.[feature]) || 0),
    ])
  );

  const below = Object.entries(minimums)
    .filter(([feature, min]) => requested[feature] < min)
    .map(([feature, min]) => ({
      field: feature,
      message: `Custom plans start at ${min} for this feature.`,
      feature,
      requested: requested[feature],
      minimum: min,
    }));

  if (below.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.PLAN.CUSTOM_BELOW_MINIMUM, below);
  }

  const ratio = customRatioFrom(await proMaxRatio(settings), settings);
  const pricePaise = quotePaise(requested, ratio, settings);
  const mrpPaise = listTotalPaise(requested, settings);

  return {
    tier: PLAN_TIER.CUSTOM,
    code: PLAN_TIER.CUSTOM,
    name: 'Custom plan',
    quotas: requested,
    pricePaise,
    priceInr: pricePaise / 100,
    mrpPaise,
    mrpInr: mrpPaise / 100,
    savingPaise: Math.max(0, mrpPaise - pricePaise),
    discountPercent: Math.round((1 - ratio) * 100),
    rates: Object.fromEntries(
      Object.keys(requested).map((feature) => [
        feature,
        Math.round(listPriceFor(feature, settings) * ratio),
      ])
    ),
    minimums,
  };
};

/**
 * The catalogue a given user sees: active plans whose audience matches their
 * userType (or ALL), plus the custom tier descriptor.
 */
const listForUser = async (userType = null) => {
  const settings = await settingsService.getAll();

  const audiences = [PLAN_AUDIENCE.ALL];
  if (userType && Object.values(PLAN_AUDIENCE).includes(userType)) audiences.push(userType);

  const plans = await Plan.find({ isActive: true, audience: { $in: audiences } })
    .sort({ sortOrder: 1, pricePaise: 1 })
    .lean();

  return {
    plans: plans.map((plan) => decorate(plan, settings)),
    custom: await customTierInfo(settings),
  };
};

const getActiveByCode = async (code) => {
  const plan = await Plan.findOne({ code: String(code).toUpperCase() });

  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.PLAN.NOT_FOUND);
  if (!plan.isActive) throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.PLAN.INACTIVE);

  return plan;
};

/**
 * The decoy ladder guard. Runs whenever an admin creates or edits a plan.
 *
 * Hard failure: an active pack priced *below* the custom rate. That inverts the
 * whole model — buying 20 checks would beat buying 100 — and it is the one
 * misconfiguration that must never reach customers.
 *
 * Warning (not a failure): a lower tier discounting as deeply as Pro Max. That
 * flattens the ladder and blunts the decoy, but it is a legitimate thing to want
 * for a promotion, so it is surfaced rather than blocked.
 */
const validateLadder = async (settings, candidate = null) => {
  const stored = await Plan.find({ isActive: true }).lean();

  const plans = candidate
    ? [...stored.filter((p) => String(p._id) !== String(candidate._id)), candidate].filter(
        (p) => p.isActive
      )
    : stored;

  const proMax = plans.find((p) => p.tier === PLAN_TIER.PRO_MAX);
  const anchorRatio = proMax ? ratioOf(proMax.pricePaise, proMax.quotas, settings) : 1;
  const customRatio = customRatioFrom(anchorRatio, settings);

  const errors = [];
  const warnings = [];

  plans.forEach((plan) => {
    const planRatio = ratioOf(plan.pricePaise, plan.quotas, settings);
    const off = (r) => Math.round((1 - r) * 100);

    if (planRatio < customRatio) {
      errors.push({
        field: 'pricePaise',
        message: `${plan.code} is cheaper per check (${off(planRatio)}% off) than the custom tier (${off(customRatio)}% off). Buying a small pack would beat buying in volume.`,
        code: plan.code,
      });
      return;
    }

    if (proMax && plan.tier !== PLAN_TIER.PRO_MAX && planRatio <= anchorRatio) {
      warnings.push(
        `${plan.code} discounts at least as deeply as Pro Max (${off(planRatio)}% vs ${off(anchorRatio)}%), which flattens the pricing ladder.`
      );
    }
  });

  return { errors, warnings };
};

module.exports = {
  toQuotaObject,
  listTotalPaise,
  ratioOf,
  decorate,
  proMaxRatio,
  customTierInfo,
  quoteCustom,
  listForUser,
  getActiveByCode,
  validateLadder,
};
