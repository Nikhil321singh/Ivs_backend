const { body } = require('express-validator');

const IMEI_REGEX = /^\d{15}$/;
const AADHAAR_REGEX = /^[2-9]{1}[0-9]{11}$/;

/**
 * The canonical field is `imei1` (a dual-SIM device has two IMEIs, so the pair
 * is imei1/imei2). Clients that only ever read one IMEI naturally post a single
 * `imei`, which failed validation with "IMEI 1 is required." Accept that shape
 * by mapping it onto imei1 before validation runs. `imei1` wins if a client
 * sends both, so nothing existing changes behaviour.
 *
 * Runs before verifyImeiValidator in the route chain.
 */
const normalizeImeiBody = (req, res, next) => {
  if (req.body && req.body.imei != null && req.body.imei1 == null) {
    req.body.imei1 = req.body.imei;
  }
  next();
};

const verifyImeiValidator = [
  body('imei1')
    .trim()
    .notEmpty()
    .withMessage('IMEI 1 is required.')
    .matches(IMEI_REGEX)
    .withMessage('IMEI 1 must be exactly 15 numeric digits.'),
  body('imei2')
    .optional({ checkFalsy: true })
    .trim()
    .matches(IMEI_REGEX)
    .withMessage('IMEI 2 must be exactly 15 numeric digits.')
    .custom((value, { req }) => value !== req.body.imei1)
    .withMessage('IMEI 1 and IMEI 2 must be different.'),
  body('deviceModel')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 200 })
    .withMessage('Device model must be at most 200 characters.'),
];

// Customer Aadhaar OTP (IMEI flow).
const customerAadhaarSendOtpValidator = [
  body('aadhaarNumber')
    .trim()
    .notEmpty()
    .withMessage('Aadhaar number is required.')
    .matches(AADHAAR_REGEX)
    .withMessage('Please provide a valid 12-digit Aadhaar number.'),
];

const customerAadhaarVerifyOtpValidator = [
  body('refId')
    .trim()
    .notEmpty()
    .withMessage('refId is required.'),
  body('otp')
    .trim()
    .notEmpty()
    .withMessage('OTP is required.')
    .isNumeric()
    .withMessage('OTP must contain digits only.')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be 6 digits.'),
];

module.exports = {
  normalizeImeiBody,
  verifyImeiValidator,
  customerAadhaarSendOtpValidator,
  customerAadhaarVerifyOtpValidator,
};
