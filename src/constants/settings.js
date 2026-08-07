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
const SETTING_KEYS = Object.freeze({
  AADHAAR_VERIFICATION_ENABLED: 'aadhaarVerificationEnabled',
  KYC_REQUIRED: 'kycRequired',
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

module.exports = { SETTING_KEYS, SETTING_DEFINITIONS, DEFAULTS, PUBLIC_KEYS };
