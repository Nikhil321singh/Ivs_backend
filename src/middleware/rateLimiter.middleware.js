const rateLimit = require('express-rate-limit');

const buildLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message,
        errors: [],
      });
    },
  });

const generalLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Too many requests. Please try again later.',
});

const otpLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: 'Too many OTP requests. Please try again after some time.',
});

const imeiVerificationLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Too many IMEI verification requests. Please try again after some time.',
});

module.exports = { generalLimiter, otpLimiter, imeiVerificationLimiter };
