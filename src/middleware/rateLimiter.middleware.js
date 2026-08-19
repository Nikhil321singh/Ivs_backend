const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

/* eslint-disable no-console */

/**
 * Rate limits.
 *
 * Each ceiling can be raised from the environment so a load test can measure
 * the server instead of the limiter — a single load generator is one IP, and at
 * the default 300 per 15 minutes it would be throttled to ~0.33 rps and learn
 * nothing. Defaults below are the production values; an unset variable changes
 * nothing.
 *
 * RATE_LIMIT_DISABLED=true removes the limits entirely. Only for a load test on
 * a box you control — it also removes the brute-force protection on admin login
 * and the spend protection on paid endpoints. The server warns at boot when set.
 */
const intFromEnv = (name, fallback) => {
  const parsed = parseInt(process.env[name], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const limitsDisabled = () => process.env.RATE_LIMIT_DISABLED === 'true';

const MINUTE = 60 * 1000;

const buildLimiter = ({ windowMs, max, message, keyGenerator, skip }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    // Limits are off under NODE_ENV=test so a spec's result never depends on how
    // many ran before it.
    skip: skip || (() => process.env.NODE_ENV === 'test' || limitsDisabled()),
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message,
        errors: [],
      });
    },
  });

/**
 * Identifies WHO a request is from, for rate-limiting purposes.
 *
 * Counting per identity rather than per IP is the correct axis for almost
 * everything here. An IP is a network, not a person: it lumps together everyone
 * behind a carrier NAT or a reverse proxy, while doing nothing to stop an
 * attacker who can rotate addresses. The thing worth protecting is an account.
 *
 * Resolved in order of how strongly each signal identifies the caller:
 *   1. the authenticated user or admin, when the limiter runs after auth
 *   2. the mobile number being acted on (the OTP endpoints, pre-auth)
 *   3. the email being acted on (admin login, pre-auth)
 *   4. the bearer token, for limiters that run before auth middleware but where
 *      the caller still carries one — it is stable per session, so it stands in
 *      for the user without this module having to verify a JWT
 *
 * Returns null when the request carries no identity at all; skipUnidentified
 * below turns that into "not limited".
 */
const identityKey = (req) => {
  if (req.user && req.user.id) return `user:${req.user.id}`;
  if (req.admin && req.admin._id) return `admin:${req.admin._id}`;

  const body = req.body || {};

  // Digits only, so one number cannot claim several buckets by reformatting.
  const mobile = String(body.mobile || '').replace(/\D/g, '');
  if (mobile) {
    const countryCode = String(body.countryCode || '').replace(/\D/g, '');
    return `otp:${countryCode}${mobile}`;
  }

  const email = String(body.email || '').trim().toLowerCase();
  if (email) return `email:${email}`;

  const auth = (req.headers && req.headers.authorization) || '';
  if (auth.startsWith('Bearer ')) {
    // Hashed: the raw token is a credential and must never become a map key
    // that could surface in a heap dump or a log line.
    const digest = crypto.createHash('sha256').update(auth.slice(7)).digest('hex');
    return `tok:${digest.slice(0, 32)}`;
  }

  return null;
};

/** The OTP endpoints always carry a mobile number; kept as a named export. */
const otpKeyGenerator = (req) => identityKey(req);

/**
 * The key every limiter uses. Identity only — there is deliberately no IP
 * fallback, so nothing here can ever be affected by where a request came from.
 *
 * Safe to return identityKey directly because skipUnidentified below runs first
 * and bypasses the limiter when there is no identity, so this is never reached
 * with null. That ordering matters: falling back to a constant would put every
 * anonymous caller in one shared bucket, which is the exact failure this whole
 * module was rewritten to remove.
 */
const identityKeyOnly = (req) => identityKey(req);

/**
 * Requests with no identity are not limited.
 *
 * An IP is a network, not a person: limiting by it punishes everyone behind one
 * office router, carrier NAT or reverse proxy while doing nothing to stop an
 * attacker who can change address. This deployment therefore counts only what
 * identifies an account — user, mobile number, email, token — and lets the
 * remaining anonymous traffic (the cheap public reads: /health, /pricing,
 * /settings) through unmetered.
 */
const skipUnidentified = (req) => {
  if (process.env.NODE_ENV === 'test' || limitsDisabled()) return true;

  return identityKey(req) === null;
};

const generalLimiter = buildLimiter({
  windowMs: intFromEnv('RATE_LIMIT_GENERAL_WINDOW_MIN', 15) * MINUTE,
  max: intFromEnv('RATE_LIMIT_GENERAL_MAX', 300),
  message: 'Too many requests. Please try again later.',
  keyGenerator: identityKeyOnly,
  skip: skipUnidentified,
});

// Caps how many OTPs one number can trigger. Keyed per number, so a hundred
// people can sign up at once without competing for a shared ceiling, while a
// single number cannot be used to run up SMS spend or bomb someone's phone.
//
// The message is built from the configured window rather than hardcoded, so
// raising RATE_LIMIT_OTP_WINDOW_MIN can never leave the text telling users to
// wait a length of time that is no longer true.
const OTP_WINDOW_MIN = intFromEnv('RATE_LIMIT_OTP_WINDOW_MIN', 10);

const otpSendLimiter = buildLimiter({
  windowMs: OTP_WINDOW_MIN * MINUTE,
  max: intFromEnv('RATE_LIMIT_OTP_MAX', 3),
  message: `Too many OTP requests for this number. Please try again after ${OTP_WINDOW_MIN} minutes.`,
  keyGenerator: otpKeyGenerator,
  skip: skipUnidentified,
});

// The brute-force guard on a 6-digit code, keyed per number so changing network
// buys an attacker no extra guesses. Separate ceiling from sending, so a user
// who legitimately re-sent an OTP still has attempts left to type it.
const otpVerifyLimiter = buildLimiter({
  windowMs: intFromEnv('RATE_LIMIT_OTP_VERIFY_WINDOW_MIN', 10) * MINUTE,
  max: intFromEnv('RATE_LIMIT_OTP_VERIFY_MAX', 10),
  message: 'Too many incorrect attempts for this number. Please try again after some time.',
  keyGenerator: otpKeyGenerator,
  skip: skipUnidentified,
});

const imeiVerificationLimiter = buildLimiter({
  windowMs: intFromEnv('RATE_LIMIT_IMEI_WINDOW_MIN', 10) * MINUTE,
  max: intFromEnv('RATE_LIMIT_IMEI_MAX', 30),
  // Mounted after authenticate, so this is always keyed on the paying user.
  message: 'Too many IMEI verification requests. Please try again after some time.',
  keyGenerator: identityKeyOnly,
  skip: skipUnidentified,
});

// Admin login is a password endpoint, so it's the one place brute force is
// worth paying for. Keyed on the email being attempted, so guessing one
// account's password is capped no matter where the attempts come from.
const adminLoginLimiter = buildLimiter({
  windowMs: intFromEnv('RATE_LIMIT_ADMIN_LOGIN_WINDOW_MIN', 15) * MINUTE,
  max: intFromEnv('RATE_LIMIT_ADMIN_LOGIN_MAX', 10),
  message: 'Too many sign-in attempts. Please try again after some time.',
  keyGenerator: identityKeyOnly,
  skip: skipUnidentified,
});

module.exports = {
  generalLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
  imeiVerificationLimiter,
  adminLoginLimiter,
  limitsDisabled,
  // Exported for tests — these carry the logic worth asserting on.
  identityKey,
  otpKeyGenerator,
  identityKeyOnly,
};
