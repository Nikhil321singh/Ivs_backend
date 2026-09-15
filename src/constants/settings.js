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
  AUCTION_LISTING_COST: 'auctionListingCost',
  AUCTION_LISTING_LIST_PRICE_PAISE: 'auctionListingListPricePaise',
  AUCTION_MIN_DURATION_MINUTES: 'auctionMinDurationMinutes',
  AUCTION_MAX_DURATION_DAYS: 'auctionMaxDurationDays',
  AUCTION_MAX_PHOTOS: 'auctionMaxPhotos',
  AUCTION_ANTI_SNIPE_ENABLED: 'auctionAntiSnipeEnabled',
  AUCTION_ANTI_SNIPE_WINDOW_SECONDS: 'auctionAntiSnipeWindowSeconds',
  AUCTION_ANTI_SNIPE_EXTEND_SECONDS: 'auctionAntiSnipeExtendSeconds',
  AUCTION_PAYMENT_WINDOW_HOURS: 'auctionPaymentWindowHours',
  AUCTION_REQUIRE_DIAGNOSIS: 'auctionRequireDiagnosis',
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
  // ---- Auctions (see AUCTION_DESIGN.md) -----------------------------------
  [SETTING_KEYS.AUCTION_LISTING_COST]: {
    type: 'integer',
    default: PRICING.FEATURES.AUCTION_LISTING,
    min: 0,
    max: 10000,
    public: true,
    label: 'Auction listing price (tokens)',
    description:
      'What publishing one auction costs. Charged on publish only — never for a draft, and never again for the same listing. Set 0 to make listing free.',
  },
  [SETTING_KEYS.AUCTION_LISTING_LIST_PRICE_PAISE]: {
    type: 'integer',
    default: PRICING.FEATURES.AUCTION_LISTING * 100,
    min: 0,
    max: 10000000,
    public: true,
    label: 'Auction listing list price (paise)',
    description:
      'The a-la-carte price of one listing. Anchor only — it is what a pack including listings is measured against.',
  },
  [SETTING_KEYS.AUCTION_MIN_DURATION_MINUTES]: {
    type: 'integer',
    default: 15,
    min: 1,
    max: 10080,
    public: true,
    label: 'Minimum auction duration (minutes)',
    description:
      'Shortest auction a seller may run. Too short and nobody sees the listing before it closes.',
  },
  [SETTING_KEYS.AUCTION_MAX_DURATION_DAYS]: {
    type: 'integer',
    default: 14,
    min: 1,
    max: 90,
    public: true,
    label: 'Maximum auction duration (days)',
    description: 'Longest auction a seller may run.',
  },
  [SETTING_KEYS.AUCTION_MAX_PHOTOS]: {
    type: 'integer',
    default: 8,
    min: 1,
    max: 20,
    public: true,
    label: 'Maximum photos per listing',
    description: 'How many device photos one auction may carry.',
  },
  [SETTING_KEYS.AUCTION_ANTI_SNIPE_ENABLED]: {
    type: 'boolean',
    default: true,
    public: true,
    label: 'Extend auctions on last-second bids',
    description:
      'When on, a bid placed inside the final window pushes the end time out. Without it the winner is whoever has the fastest connection rather than the highest bid.',
  },
  [SETTING_KEYS.AUCTION_ANTI_SNIPE_WINDOW_SECONDS]: {
    type: 'integer',
    default: 120,
    min: 10,
    max: 3600,
    public: true,
    label: 'Anti-sniping window (seconds)',
    description: 'A bid landing within this long of the end time triggers an extension.',
  },
  [SETTING_KEYS.AUCTION_ANTI_SNIPE_EXTEND_SECONDS]: {
    type: 'integer',
    default: 120,
    min: 10,
    max: 3600,
    public: true,
    label: 'Anti-sniping extension (seconds)',
    description: 'How far the end time moves out when a late bid triggers an extension.',
  },
  [SETTING_KEYS.AUCTION_PAYMENT_WINDOW_HOURS]: {
    type: 'integer',
    default: 48,
    min: 1,
    max: 720,
    public: true,
    label: 'Winner payment window (hours)',
    description:
      'How long the winning bidder has to pay before the sale lapses. After this the auction becomes PAYMENT_EXPIRED and the seller is free to relist.',
  },
  [SETTING_KEYS.AUCTION_REQUIRE_DIAGNOSIS]: {
    type: 'boolean',
    default: false,
    public: true,
    label: 'Require a diagnosis to publish an auction',
    description:
      'When on, a listing cannot go live without a linked device diagnosis. Makes every listing trustworthy, at the cost of listing friction.',
  },
});

// Maps a PRICING.FEATURES key to the setting that overrides it, so
// requireBalance and the feature services can look the price up by feature key.
const FEATURE_COST_KEYS = Object.freeze({
  IVS_CHECK: SETTING_KEYS.IVS_CHECK_COST,
  DIAGNOSE: SETTING_KEYS.DIAGNOSE_COST,
  AUCTION_LISTING: SETTING_KEYS.AUCTION_LISTING_COST,
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
