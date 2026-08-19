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

  // Free tokens credited once, when a user completes KYC.
  //
  // Currently 0: the grant is off. grantSignupBonus returns early on a
  // non-positive value, so no wallet is created and no zero-value ledger row is
  // written — an account simply has no wallet until something credits it. The
  // referral reward, paid on the referred user's first successful top-up, is
  // the only bonus in the system.
  //
  // Raise this to re-enable it; nothing else needs to change, and accounts that
  // already received it keep those tokens.
  SIGNUP_BONUS: 0,

  // Referral payout, in tokens, granted on the referee's first paid top-up.
  REFERRAL: Object.freeze({
    REFERRER_BONUS: 50, // credited to the person who shared the code
    REFEREE_WELCOME: 10, // credited to the new user who used the code
  }),
});
