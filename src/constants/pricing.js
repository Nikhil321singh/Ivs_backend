/**
 * Central pricing config. Token economics: 1 token = ₹1, so a ₹100 top-up
 * credits 100 tokens and a feature that costs `20` costs the user ₹20.
 *
 * Kept as constants (versioned, no DB round-trip) for now. If prices need to
 * change without a deploy, move FEATURES/REFERRAL into a `Pricing` collection
 * and read through this module — callers won't need to change.
 */
module.exports = Object.freeze({
  // How many tokens ₹1 buys. Keep at 1 unless the product moves to packs.
  TOKEN_PER_INR: 1,

  // Guard rails for a single top-up (in ₹).
  MIN_TOPUP_INR: 10,
  MAX_TOPUP_INR: 100000,

  // Per-feature cost, in tokens. Keys are the featureKey passed to
  // requireBalance() and used as the ledger referenceType.
  FEATURES: Object.freeze({
    IVS_CHECK: 19,
    DIAGNOSE: 50,
  }),

  // Free tokens credited once, when an account is first created, so a new user
  // can try paid features before topping up. Set to 0 to switch the grant off —
  // the credit is skipped entirely rather than writing a zero-value ledger row.
  SIGNUP_BONUS: 100,

  // Referral payout, in tokens, granted on the referee's first paid top-up.
  REFERRAL: Object.freeze({
    REFERRER_BONUS: 20, // credited to the person who shared the code
    REFEREE_WELCOME: 10, // credited to the new user who used the code
  }),
});
