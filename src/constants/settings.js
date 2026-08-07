/**
 * Runtime settings: keys, defaults and metadata for the admin portal.
 *
 * A key missing from the Setting collection falls back to `default` here, so a
 * fresh database boots with sane behaviour and needs no seeding. The portal
 * renders one toggle per entry using `label` / `description`.
 */
const SETTING_KEYS = Object.freeze({
  AADHAAR_VERIFICATION_ENABLED: 'aadhaarVerificationEnabled',
});

const SETTING_DEFINITIONS = Object.freeze({
  [SETTING_KEYS.AADHAAR_VERIFICATION_ENABLED]: {
    type: 'boolean',
    default: true,
    label: 'Aadhaar verification required',
    description:
      'When off, Aadhaar is not required anywhere: KYC completes without it, and the Aadhaar OTP endpoints succeed without contacting UIDAI. Turn off if the provider is down.',
  },
});

const DEFAULTS = Object.freeze(
  Object.fromEntries(
    Object.entries(SETTING_DEFINITIONS).map(([key, def]) => [key, def.default])
  )
);

module.exports = { SETTING_KEYS, SETTING_DEFINITIONS, DEFAULTS };
