/**
 * Enums shared by the entitlement/plan models and services, so the credit
 * vocabulary lives in exactly one place — the same role walletEnums.js plays
 * for the money ledger.
 */
const ENTITLEMENT_TXN_TYPE = Object.freeze({
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
});

const ENTITLEMENT_REASON = Object.freeze({
  PLAN_PURCHASE: 'PLAN_PURCHASE', // credits granted by a paid plan/custom pack
  FEATURE_USE: 'FEATURE_USE', // one credit consumed by a billable feature run
  ADMIN_ADJUSTMENT: 'ADMIN_ADJUSTMENT', // manual portal grant or deduction
  REFUND: 'REFUND', // credits returned to the customer
});

const ENTITLEMENT_REF_TYPE = Object.freeze({
  PAYMENT: 'PAYMENT',
  IVS_CHECK: 'IVS_CHECK',
  DIAGNOSE: 'DIAGNOSE',
  AUCTION_LISTING: 'AUCTION_LISTING',
});

const PLAN_TIER = Object.freeze({
  BASIC: 'BASIC',
  PRO: 'PRO',
  PRO_MAX: 'PRO_MAX',
  CUSTOM: 'CUSTOM',
});

/**
 * Who a plan is sold to. Values mirror constants/userType.js so a plan can be
 * matched against `User.userType` directly; ALL means "everyone", which is also
 * what a user with no userType yet (KYC incomplete) sees.
 */
const PLAN_AUDIENCE = Object.freeze({
  INDIVIDUAL: 'individual',
  VENDOR: 'vendor',
  ALL: 'all',
});

/** What a Razorpay order was raised for. Legacy rows have no field → TOPUP. */
const PAYMENT_PURPOSE = Object.freeze({
  TOPUP: 'TOPUP', // money into the token wallet (the legacy model)
  PLAN: 'PLAN', // a credit pack purchase
  AUCTION: 'AUCTION', // a winning bidder paying for the device they won
});

/**
 * Which billing system charges a paid feature. Operator-switchable at runtime
 * so the wallet can be revived (or run alongside) without a deploy — see
 * SUBSCRIPTION_DESIGN.md §7.
 */
const BILLING_MODE = Object.freeze({
  SUBSCRIPTION: 'SUBSCRIPTION', // credits only
  WALLET: 'WALLET', // tokens only (pre-subscription behaviour)
  BOTH: 'BOTH', // credits first, tokens as fallback
});

/** Where a single feature run was billed from. Set by requireFeatureAccess. */
const BILLING_SOURCE = Object.freeze({
  ENTITLEMENT: 'ENTITLEMENT',
  WALLET: 'WALLET',
});

module.exports = {
  ENTITLEMENT_TXN_TYPE,
  ENTITLEMENT_REASON,
  ENTITLEMENT_REF_TYPE,
  PLAN_TIER,
  PLAN_AUDIENCE,
  PAYMENT_PURPOSE,
  BILLING_MODE,
  BILLING_SOURCE,
};
