const Setting = require('../models/Setting.model');
const {
  SETTING_DEFINITIONS,
  DEFAULTS,
  SETTING_KEYS,
  PUBLIC_KEYS,
  FEATURE_COST_KEYS,
} = require('../constants/settings');
const PRICING = require('../constants/pricing');

/**
 * Reads runtime settings through a short-lived in-process cache.
 *
 * These are consulted on hot paths (every KYC and Aadhaar request), so hitting
 * Mongo each time would add a round trip to requests that don't need one. The
 * TTL is deliberately short: a toggle flipped in the portal takes effect within
 * CACHE_TTL_MS everywhere, including any other PM2 instance that didn't serve
 * the write. The writing process clears its own cache immediately, so the
 * portal always reflects the change on the next read.
 */
const CACHE_TTL_MS = 15000;

let cache = null;
let cacheExpiresAt = 0;

const invalidateCache = () => {
  cache = null;
  cacheExpiresAt = 0;
};

const coerce = (key, value) => {
  const definition = SETTING_DEFINITIONS[key];
  if (!definition) return value;

  if (definition.type === 'boolean') return value === true || value === 'true';

  if (definition.type === 'integer') {
    const parsed = parseInt(value, 10);
    // A malformed stored value must never become NaN and propagate into a
    // wallet debit — fall back to the compiled-in default instead.
    if (!Number.isInteger(parsed)) return definition.default;
    if (definition.min !== undefined && parsed < definition.min) return definition.min;
    if (definition.max !== undefined && parsed > definition.max) return definition.max;
    return parsed;
  }

  return value;
};

/**
 * All settings, with any key absent from the database falling back to its
 * default. Never throws: if the read fails we serve defaults rather than take
 * the whole API down over a settings lookup.
 */
const getAll = async () => {
  if (cache && Date.now() < cacheExpiresAt) {
    return cache;
  }

  let resolved = { ...DEFAULTS };

  try {
    const rows = await Setting.find({ key: { $in: Object.keys(SETTING_DEFINITIONS) } }).lean();
    rows.forEach((row) => {
      resolved[row.key] = coerce(row.key, row.value);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Settings] Read failed, serving defaults:', err.message);
    resolved = { ...DEFAULTS };
  }

  cache = resolved;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;

  return resolved;
};

const get = async (key) => (await getAll())[key];

/**
 * Upserts one or more settings. Unknown keys are ignored rather than stored, so
 * a malformed portal request can't pollute the collection.
 */
const update = async (patch, adminId = null) => {
  const applied = {};

  await Promise.all(
    Object.entries(patch)
      .filter(([key]) => SETTING_DEFINITIONS[key])
      .map(async ([key, rawValue]) => {
        const value = coerce(key, rawValue);
        applied[key] = value;
        await Setting.findOneAndUpdate(
          { key },
          { key, value, updatedBy: adminId },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      })
  );

  invalidateCache();

  return { applied, settings: await getAll() };
};

/** Convenience readers for the kill switches — the hot-path callers. */
const isAadhaarVerificationEnabled = () => get(SETTING_KEYS.AADHAAR_VERIFICATION_ENABLED);
const isKycRequired = () => get(SETTING_KEYS.KYC_REQUIRED);

/**
 * Effective price of a paid feature, in tokens.
 *
 * Reads the operator-set override, falling back to the compiled-in default in
 * constants/pricing.js. Every charge path must go through this rather than
 * PRICING.FEATURES directly, or a price change would apply in one place and not
 * another — the balance check and the debit disagreeing is the worst version of
 * that bug.
 */
const getFeatureCost = async (featureKey) => {
  const settingKey = FEATURE_COST_KEYS[featureKey];

  if (!settingKey) return PRICING.FEATURES[featureKey];

  return get(settingKey);
};

/** All feature prices at once, for the pricing endpoint. */
const getFeatureCosts = async () => {
  const all = await getAll();

  return Object.fromEntries(
    Object.keys(PRICING.FEATURES).map((feature) => [
      feature,
      FEATURE_COST_KEYS[feature] ? all[FEATURE_COST_KEYS[feature]] : PRICING.FEATURES[feature],
    ])
  );
};

/**
 * The subset safe to hand to any caller (see `public` in constants/settings.js).
 * Backs the unauthenticated GET /api/v1/settings that clients read to decide
 * whether to show the KYC and Aadhaar screens at all.
 */
const getPublic = async () => {
  const all = await getAll();
  return Object.fromEntries(PUBLIC_KEYS.map((key) => [key, all[key]]));
};

module.exports = {
  getAll,
  get,
  getPublic,
  update,
  invalidateCache,
  isAadhaarVerificationEnabled,
  isKycRequired,
  getFeatureCost,
  getFeatureCosts,
};
