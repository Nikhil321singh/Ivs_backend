const { body } = require('express-validator');

const MOBILE_REGEX = /^[6-9]\d{9}$/;
const COUNTRY_CODE_REGEX = /^\+\d{1,4}$/;

const sendOtpValidator = [
  body('mobile')
    .trim()
    .notEmpty()
    .withMessage('Mobile number is required.')
    .matches(MOBILE_REGEX)
    .withMessage('Please provide a valid 10-digit mobile number.'),
  body('countryCode')
    .optional()
    .trim()
    .matches(COUNTRY_CODE_REGEX)
    .withMessage('Country code must be in the format +91.'),
];

const verifyOtpValidator = [
  body('mobile')
    .trim()
    .notEmpty()
    .withMessage('Mobile number is required.')
    .matches(MOBILE_REGEX)
    .withMessage('Please provide a valid 10-digit mobile number.'),
  body('countryCode')
    .optional()
    .trim()
    .matches(COUNTRY_CODE_REGEX)
    .withMessage('Country code must be in the format +91.'),
  body('otp')
    .trim()
    .notEmpty()
    .withMessage('OTP is required.')
    .isNumeric()
    .withMessage('OTP must contain digits only.')
    .isLength({ min: 4, max: 6 })
    .withMessage('OTP must be between 4 and 6 digits.'),
  body('deviceId').trim().notEmpty().withMessage('Device ID is required.'),
  body('referralCode')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 4, max: 20 })
    .withMessage('Invalid referral code.'),
];

const refreshTokenValidator = [
  body('refreshToken').trim().notEmpty().withMessage('Refresh token is required.'),
  body('deviceId').trim().notEmpty().withMessage('Device ID is required.'),
];

const logoutValidator = [body('deviceId').trim().notEmpty().withMessage('Device ID is required.')];

module.exports = {
  sendOtpValidator,
  verifyOtpValidator,
  refreshTokenValidator,
  logoutValidator,
};
