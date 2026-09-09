/**
 * Runtime settings: keys, defaults and metadata for the admin portal.
 *
 * A key missing from the Setting collection falls back to `default` here, so a
 * fresh database boots with sane behaviour and needs no seeding. The portal
 * renders one toggle per entry using `label` / `description`.
 *
 * `public: true` exposes the key on GET /api/v1/settings (unauthenticated), so
 * clients can adapt their UI — hiding a KYC screen rather than posting into it.
 * Only mark a key public if leaking its value to any caller is harmless.
 */
const PRICING = require('./pricing');
const { BILLING_MODE } = require('./entitlementEnums');

const SETTING_KEYS = Object.freeze({
  AADHAAR_VERIFICATION_ENABLED: 'aadhaarVerificationEnabled',
  KYC_REQUIRED: 'kycRequired',
  IVS_CHECK_COST: 'ivsCheckCost',
  DIAGNOSE_COST: 'diagnoseCost',
  BILLING_MODE: 'billingMode',
  IVS_LIST_PRICE_PAISE: 'ivsListPricePaise',
  DIAGNOSE_LIST_PRICE_PAISE: 'diagnoseListPricePaise',
  CUSTOM_MIN_IVS_CHECK: 'customMinIvsCheck',
  CUSTOM_MIN_DIAGNOSE: 'customMinDiagnose',
  CUSTOM_DISCOUNT_PERCENT: 'customDiscountPercent',
});

const SETTING_DEFINITIONS = Object.freeze({
  [SETTING_KEYS.AADHAAR_VERIFICATION_ENABLED]: {
    type: 'boolean',
    default: true,
    public: true,
    label: 'Aadhaar verification required',
    description:
      'When off, Aadhaar is not required anywhere: KYC completes without it, and the Aadhaar OTP endpoints succeed without contacting UIDAI. Turn off if the provider is down.',
  },
  [SETTING_KEYS.KYC_REQUIRED]: {
    type: 'boolean',
    default: true,
    public: true,
    label: 'KYC required',
    description:
      'When off, users can finish onboarding without submitting KYC: every complete-kyc field becomes optional and /user/skip-kyc marks the account done. Existing KYC data is never deleted.',
  },
  // Feature prices, in tokens (1 token = ₹1). Editable at runtime so a price
  // change does not need a deploy. Defaults come from constants/pricing.js, so
  // that file stays the single source of truth for what a fresh install costs.
  [SETTING_KEYS.IVS_CHECK_COST]: {
    type: 'integer',
    default: PRICING.FEATURES.IVS_CHECK,
    min: 0,
    max: 10000,
    public: true,
    label: 'IMEI check price (tokens)',
    description:
      'What one IMEI verification costs. Applies to the next check made — checks already completed keep the price they were charged. Set 0 to make the feature free.',
  },
  [SETTING_KEYS.DIAGNOSE_COST]: {
    type: 'integer',
    default: PRICING.FEATURES.DIAGNOSE,
    min: 0,
    max: 10000,
    public: true,
    label: 'Device diagnosis price (tokens)',
    description:
      'What one device diagnosis costs. Applies to the next diagnosis run. Set 0 to make the feature free.',
  },
  // ---- Credit packs (see SUBSCRIPTION_DESIGN.md) --------------------------
  [SETTING_KEYS.BILLING_MODE]: {
    type: 'string',
    enum: Object.values(BILLING_MODE),
    default: BILLING_MODE.SUBSCRIPTION,
    public: true,
    label: 'Billing mode',
    description:
      'SUBSCRIPTION charges paid features against credit packs. WALLET restores the old pay-per-use token wallet. BOTH tries credits first and falls back to tokens — use it during cutover so existing token balances drain instead of stranding.',
  },
  [SETTING_KEYS.IVS_LIST_PRICE_PAISE]: {
    type: 'integer',
    default: PRICING.FEATURES.IVS_CHECK * 100,
    min: 0,
    max: 10000000,
    public: true,
    label: 'IMEI check list price (paise)',
    description:
      'The a-la-carte price of one IMEI check. Not charged to anyone directly: it is the anchor every pack is measured against, so it sets the strikethrough MRP and the per-check saving shown on each plan card.',
  },
  [SETTING_KEYS.DIAGNOSE_LIST_PRICE_PAISE]: {
    type: 'integer',
    default: PRICING.FEATURES.DIAGNOSE * 100,
    min: 0,
    max: 10000000,
    public: true,
    label: 'Device diagnosis list price (paise)',
    description:
      'The a-la-carte price of one device diagnosis. Anchor only — see the IMEI list price.',
  },
  [SETTING_KEYS.CUSTOM_MIN_IVS_CHECK]: {
    type: 'integer',
    default: 100,
    min: 1,
    max: 100000,
    public: true,
    label: 'Custom plan minimum — IMEI checks',
    description:
      'Fewest IMEI checks a customer may buy on the custom tier. Below this the order is refused and the app is told the minimum.',
  },
  [SETTING_KEYS.CUSTOM_MIN_DIAGNOSE]: {
    type: 'integer',
    default: 50,
    min: 1,
    max: 100000,
    public: true,
    label: 'Custom plan minimum — diagnoses',
    description: 'Fewest device diagnoses a customer may buy on the custom tier.',
  },
  [SETTING_KEYS.CUSTOM_DISCOUNT_PERCENT]: {
    type: 'integer',
    default: 5,
    min: 0,
    max: 90,
    public: true,
    label: 'Custom plan discount (%)',
    description:
      'Taken off the Pro Max per-check rate, NOT off the list price — that is what keeps the custom tier structurally the cheapest per check however the packs are repriced.',
  },
});

// Maps a PRICING.FEATURES key to the setting that overrides it, so
// requireBalance and the feature services can look the price up by feature key.
const FEATURE_COST_KEYS = Object.freeze({
  IVS_CHECK: SETTING_KEYS.IVS_CHECK_COST,
  DIAGNOSE: SETTING_KEYS.DIAGNOSE_COST,
});

const DEFAULTS = Object.freeze(
  Object.fromEntries(
    Object.entries(SETTING_DEFINITIONS).map(([key, def]) => [key, def.default])
  )
);

const PUBLIC_KEYS = Object.freeze(
  Object.entries(SETTING_DEFINITIONS)
    .filter(([, def]) => def.public)
    .map(([key]) => key)
);

module.exports = {
  SETTING_KEYS,
  SETTING_DEFINITIONS,
  DEFAULTS,
  PUBLIC_KEYS,
  FEATURE_COST_KEYS,
};
