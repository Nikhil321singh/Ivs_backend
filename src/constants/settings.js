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

const SETTING_KEYS = Object.freeze({
  AADHAAR_VERIFICATION_ENABLED: 'aadhaarVerificationEnabled',
  KYC_REQUIRED: 'kycRequired',
  IVS_CHECK_COST: 'ivsCheckCost',
  DIAGNOSE_COST: 'diagnoseCost',
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
