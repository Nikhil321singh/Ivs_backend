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

/**
 * True when we cannot tell one client from another.
 *
 * Node only ever sees the peer of the TCP connection. Behind a reverse proxy on
 * the same host that peer is always loopback, and the real client IP survives
 * only if the proxy copies it into X-Forwarded-For. When that header is missing,
 * `req.ip` silently falls back to the socket address and EVERY request in the
 * world resolves to 127.0.0.1 — so an IP-keyed limiter stops being "N per
 * client" and becomes "N in total", locking out all users at once.
 *
 * This is a silent failure: an absent X-Forwarded-For is indistinguishable from
 * a genuine direct connection, so neither Express nor express-rate-limit can
 * detect it. Hence the explicit check.
 */
const clientIpUnresolved = (req) => {
  if (req.headers && req.headers['x-forwarded-for']) return false;

  const ip = req.ip || '';
  return ip === '::1' || ip === '127.0.0.1' || ip.endsWith(':127.0.0.1');
};

const MINUTE = 60 * 1000;

/**
 * Logged once per process, not repeatedly.
 *
 * This deployment runs behind a proxy that does not forward the client IP, and
 * that is accepted rather than a bug to chase: every limit that matters is keyed
 * on identity (user, mobile number, email, token), so it holds regardless. The
 * only requests that reach the IP fallback are fully anonymous ones, and those
 * are the cheap public reads.
 *
 * Repeating this every few minutes would be permanent noise in the production
 * log describing a deliberate configuration, so it states the situation once at
 * first occurrence and then stays quiet.
 */
let warnedUnresolvedIp = false;

const warnUnresolvedIp = (req) => {
  if (warnedUnresolvedIp) return;
  warnedUnresolvedIp = true;

  console.warn(
    '[RateLimit] Client IP is unresolved (req.ip=%s, no X-Forwarded-For), so ' +
      'anonymous requests are not rate limited. Named limits (per user, per ' +
      'mobile number, per email) are unaffected. Set X-Forwarded-For at the ' +
      'proxy if anonymous endpoints ever need limiting. Logged once.',
    req.ip
  );
};

const buildLimiter = ({ windowMs, max, message, keyGenerator, skip }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    // Every request in the test suite comes from 127.0.0.1, so a shared counter
    // would make results depend on how many tests ran before — the OTP limiter
    // (5 per 10 min) trips on the sixth spec.
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
 * Returns null when the request carries no identity at all, leaving the caller
 * to decide whether to fall back to the IP or skip.
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
const otpKeyGenerator = (req) => identityKey(req) || `ip:${req.ip}`;

/**
 * Falls back to the IP only for callers with no identity at all — an anonymous
 * request to a public endpoint. Everything else is counted per account.
 */
const identityOrIpKey = (req) => identityKey(req) || `ip:${req.ip}`;

/**
 * Skips only when BOTH signals are useless: no identity to count against, and
 * an IP that resolves to loopback for every caller. Previously this skipped any
 * IP-keyed limiter under a broken proxy, which switched the protection off for
 * authenticated traffic too; now that traffic is keyed per user and keeps its
 * limit regardless of what the proxy does.
 */
const skipWhenUnidentifiable = (req) => {
  if (process.env.NODE_ENV === 'test' || limitsDisabled()) return true;

  if (identityKey(req) === null && clientIpUnresolved(req)) {
    warnUnresolvedIp(req);
    return true;
  }

  return false;
};

const generalLimiter = buildLimiter({
  windowMs: intFromEnv('RATE_LIMIT_GENERAL_WINDOW_MIN', 15) * MINUTE,
  max: intFromEnv('RATE_LIMIT_GENERAL_MAX', 300),
  message: 'Too many requests. Please try again later.',
  keyGenerator: identityOrIpKey,
  skip: skipWhenUnidentifiable,
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
});

// The brute-force guard on a 6-digit code. send-otp is deliberately
// unthrottled (see auth.routes.js), so this is the only ceiling on the OTP
// flow — it is what stops a code being guessed, keyed per number so rotating
// IPs does not buy an attacker more attempts.
const otpVerifyLimiter = buildLimiter({
  windowMs: intFromEnv('RATE_LIMIT_OTP_VERIFY_WINDOW_MIN', 10) * MINUTE,
  max: intFromEnv('RATE_LIMIT_OTP_VERIFY_MAX', 10),
  message: 'Too many incorrect attempts for this number. Please try again after some time.',
  keyGenerator: otpKeyGenerator,
});

const imeiVerificationLimiter = buildLimiter({
  windowMs: intFromEnv('RATE_LIMIT_IMEI_WINDOW_MIN', 10) * MINUTE,
  max: intFromEnv('RATE_LIMIT_IMEI_MAX', 30),
  // Mounted after authenticate, so this is always keyed on the paying user.
  message: 'Too many IMEI verification requests. Please try again after some time.',
  keyGenerator: identityOrIpKey,
  skip: skipWhenUnidentifiable,
});

// Admin login is a password endpoint, so it's the one place brute force is
// worth paying for. Keyed on the email being attempted, so guessing one
// account's password is capped no matter where the attempts come from.
const adminLoginLimiter = buildLimiter({
  windowMs: intFromEnv('RATE_LIMIT_ADMIN_LOGIN_WINDOW_MIN', 15) * MINUTE,
  max: intFromEnv('RATE_LIMIT_ADMIN_LOGIN_MAX', 10),
  message: 'Too many sign-in attempts. Please try again after some time.',
  keyGenerator: identityOrIpKey,
  skip: skipWhenUnidentifiable,
});

module.exports = {
  generalLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
  imeiVerificationLimiter,
  adminLoginLimiter,
  limitsDisabled,
  // Exported for tests — these carry the logic worth asserting on.
  clientIpUnresolved,
  identityKey,
  otpKeyGenerator,
  identityOrIpKey,
};
