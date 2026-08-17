const rateLimit = require('express-rate-limit');

/**
 * Per-IP rate limits.
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

const buildLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Every request in the test suite comes from 127.0.0.1, so a shared counter
    // would make results depend on how many tests ran before — the OTP limiter
    // (5 per 10 min) trips on the sixth spec.
    skip: () => process.env.NODE_ENV === 'test' || limitsDisabled(),
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message,
        errors: [],
      });
    },
  });

const MINUTE = 60 * 1000;

const generalLimiter = buildLimiter({
  windowMs: intFromEnv('RATE_LIMIT_GENERAL_WINDOW_MIN', 15) * MINUTE,
  max: intFromEnv('RATE_LIMIT_GENERAL_MAX', 300),
  message: 'Too many requests. Please try again later.',
});

const otpLimiter = buildLimiter({
  windowMs: intFromEnv('RATE_LIMIT_OTP_WINDOW_MIN', 10) * MINUTE,
  max: intFromEnv('RATE_LIMIT_OTP_MAX', 5),
  message: 'Too many OTP requests. Please try again after some time.',
});

const imeiVerificationLimiter = buildLimiter({
  windowMs: intFromEnv('RATE_LIMIT_IMEI_WINDOW_MIN', 10) * MINUTE,
  max: intFromEnv('RATE_LIMIT_IMEI_MAX', 30),
  message: 'Too many IMEI verification requests. Please try again after some time.',
});

// Admin login is a password endpoint, so it's the one place brute force is
// worth paying for. Tighter than the OTP limiter and keyed per IP.
const adminLoginLimiter = buildLimiter({
  windowMs: intFromEnv('RATE_LIMIT_ADMIN_LOGIN_WINDOW_MIN', 15) * MINUTE,
  max: intFromEnv('RATE_LIMIT_ADMIN_LOGIN_MAX', 10),
  message: 'Too many sign-in attempts. Please try again after some time.',
});

module.exports = {
  generalLimiter,
  otpLimiter,
  imeiVerificationLimiter,
  adminLoginLimiter,
  limitsDisabled,
};
