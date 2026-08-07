const crypto = require('crypto');

/**
 * Refresh tokens are never stored in plaintext. We persist a SHA-256 hash so a
 * database leak alone cannot be used to impersonate a session.
 */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Hash of an Aadhaar number for the `aadhaarNumberHash` field, which carries a
 * sparse UNIQUE index so one Aadhaar maps to at most one account.
 *
 * Sandbox numbers (AADHAAR_TEST_MODE) must be reusable across testers, so for
 * those we salt the hash with the userId. Each tester then gets a distinct
 * value, which satisfies the unique index and makes the "already linked to
 * another account" lookups miss by construction — no special-casing needed at
 * the call sites. The same userId always yields the same hash, so completeKyc's
 * "does this match the verified Aadhaar" comparison still works.
 *
 * Real Aadhaar numbers are unaffected: unsalted, globally unique, exactly as
 * before.
 */
const hashAadhaar = (aadhaarNumber, userId) => {
  // Required lazily: config/env is loaded before this util in some paths, and a
  // top-level require here would create a cycle via services/providers.
  const env = require('../config/env');
  const isTestNumber =
    env.aadhaarTest.enabled && env.aadhaarTest.numbers.includes(String(aadhaarNumber));

  return hashToken(isTestNumber ? `${aadhaarNumber}:${userId}` : String(aadhaarNumber));
};

module.exports = { hashToken, hashAadhaar };
