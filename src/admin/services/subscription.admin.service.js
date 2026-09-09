const Plan = require('../../models/Plan.model');
const Payment = require('../../models/Payment.model');
const User = require('../../models/User.model');
const planService = require('../../services/plan.service');
const entitlementService = require('../../services/entitlement.service');
const settingsService = require('../../services/settings.service');
const { PAYMENT_PURPOSE } = require('../../constants/entitlementEnums');
const { PAYMENT_STATUS } = require('../../constants/walletEnums');
const ApiError = require('../../utils/apiError');
const httpStatus = require('../../constants/httpStatus');
const MESSAGES = require('../../constants/messages');

/**
 * The portal's commercial controls: the plan catalogue, manual credit
 * adjustments, and pack revenue.
 *
 * Everything a customer pays or receives is editable here rather than in code —
 * see SUBSCRIPTION_DESIGN.md §8. Two rules run through all of it:
 *
 *  - **Deactivate, never delete.** Purchases are protected by their snapshot
 *    regardless, but history views still need the plan name to resolve.
 *  - **Never move a counter without a ledger row.** Adjustments go through the
 *    same service path as a purchase, recording which admin did it and why.
 *    Admin has no role separation, so that trail is the only control on an
 *    operator minting free credits.
 */

const EDITABLE_FIELDS = [
  'name',
  'tier',
  'quotas',
  'pricePaise',
  'mrpPaise',
  'badge',
  'highlight',
  'sortOrder',
  'audience',
  'validityDays',
  'isActive',
];

const paginate = ({ page = 1, limit = 20 }) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  return { safePage, safeLimit, skip: (safePage - 1) * safeLimit };
};

const buildPagination = (page, limit, total) => ({
  page,
  limit,
  total,
  pages: Math.ceil(total / limit) || 1,
});

/** Every plan, active or not, decorated with the same maths the app sees. */
const listPlans = async () => {
  const [plans, settings] = await Promise.all([
    Plan.find().sort({ sortOrder: 1, pricePaise: 1 }).lean(),
    settingsService.getAll(),
  ]);

  return {
    plans: plans.map((plan) => planService.decorate(plan, settings)),
    custom: await planService.customTierInfo(settings),
  };
};

const pickEditable = (payload) =>
  Object.fromEntries(
    Object.entries(payload).filter(([key]) => EDITABLE_FIELDS.includes(key))
  );

const assertQuotas = (quotas) => {
  const normalised = planService.toQuotaObject(quotas);

  const unknown = Object.keys(normalised).filter(
    (feature) => !entitlementService.isKnownFeature(feature)
  );

  if (unknown.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.ENTITLEMENT.INVALID_FEATURE, [
      { field: 'quotas', message: `Unknown feature(s): ${unknown.join(', ')}.` },
    ]);
  }

  if (!Object.keys(normalised).length) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.PLAN.INVALID_QUOTAS);
  }

  return normalised;
};

/**
 * Runs the decoy-ladder guard over the catalogue as it *would* be with this
 * plan applied. A pack priced below the custom rate is rejected — that inverts
 * the model, making a small pack cheaper per check than buying in volume. A
 * merely flat ladder is returned as a warning, because a promotion is a
 * legitimate reason to want one.
 */
const checkLadder = async (candidate) => {
  const settings = await settingsService.getAll();
  const { errors, warnings } = await planService.validateLadder(settings, candidate);

  if (errors.length) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.PLAN.LADDER_BROKEN, errors);
  }

  return { settings, warnings };
};

const createPlan = async (payload, adminId) => {
  const data = pickEditable(payload);
  const code = String(payload.code || '').trim().toUpperCase();

  if (!code) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.PLAN.CODE_REQUIRED);
  }

  if (await Plan.exists({ code })) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.PLAN.DUPLICATE_CODE);
  }

  data.quotas = assertQuotas(data.quotas);

  const { settings, warnings } = await checkLadder({ ...data, code, isActive: data.isActive !== false });

  const plan = await Plan.create({ ...data, code, updatedBy: adminId });

  return { plan: planService.decorate(plan, settings), warnings };
};

const updatePlan = async (planId, payload, adminId) => {
  const plan = await Plan.findById(planId);
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.PLAN.NOT_FOUND);

  const data = pickEditable(payload);

  // `code` is deliberately not editable: it is the identity a seed script and
  // any external reference addresses the plan by. Rename via `name`.
  if (data.quotas !== undefined) data.quotas = assertQuotas(data.quotas);

  const candidate = {
    _id: plan._id,
    code: plan.code,
    tier: data.tier ?? plan.tier,
    quotas: data.quotas ?? planService.toQuotaObject(plan.quotas),
    pricePaise: data.pricePaise ?? plan.pricePaise,
    isActive: data.isActive ?? plan.isActive,
  };

  const { settings, warnings } = await checkLadder(candidate);

  Object.assign(plan, data, { updatedBy: adminId });
  await plan.save();

  return { plan: planService.decorate(plan, settings), warnings };
};

/** A customer's credits plus the most recent movements, for the user detail screen. */
const getUserEntitlement = async (userId) => {
  const user = await User.findById(userId).select('_id name mobile userType');
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUTH.USER_NOT_FOUND);

  const [summary, ledger] = await Promise.all([
    entitlementService.getSummary(userId),
    entitlementService.getLedger(userId, { page: 1, limit: 20 }),
  ]);

  return { user, ...summary, recentTransactions: ledger.items };
};

/**
 * Manual grant or deduction. `note` is required by the validator, not optional
 * politeness: with no role separation on Admin, the note plus adminId is the
 * entire audit story for why someone's credits changed.
 */
const adjustCredits = async (userId, { feature, delta, note }, adminId) => {
  if (!(await User.exists({ _id: userId }))) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUTH.USER_NOT_FOUND);
  }

  const transaction = await entitlementService.adjust(userId, feature, delta, { adminId, note });
  const summary = await entitlementService.getSummary(userId);

  return { transaction, credits: summary.credits };
};

/** Credit-pack revenue: every PLAN payment, filterable. */
const listPlanPayments = async ({ page, limit, status = null, planCode = null, userId = null } = {}) => {
  const { safePage, safeLimit, skip } = paginate({ page, limit });

  const filter = { purpose: PAYMENT_PURPOSE.PLAN };
  if (status && Object.values(PAYMENT_STATUS).includes(status)) filter.status = status;
  if (planCode) filter['planSnapshot.code'] = String(planCode).toUpperCase();
  if (userId) filter.userId = userId;

  const [items, total, paidTotal] = await Promise.all([
    Payment.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('userId', 'name mobile userType')
      .lean(),
    Payment.countDocuments(filter),
    // Revenue over the same filter, but only what was actually captured.
    Payment.aggregate([
      { $match: { ...filter, status: PAYMENT_STATUS.PAID } },
      { $group: { _id: null, amountPaise: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
    ]),
  ]);

  return {
    items,
    revenue: {
      amountPaise: paidTotal[0]?.amountPaise || 0,
      amountInr: (paidTotal[0]?.amountPaise || 0) / 100,
      paidCount: paidTotal[0]?.count || 0,
    },
    pagination: buildPagination(safePage, safeLimit, total),
  };
};

module.exports = {
  listPlans,
  createPlan,
  updatePlan,
  getUserEntitlement,
  adjustCredits,
  listPlanPayments,
};
