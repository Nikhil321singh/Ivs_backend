const { body } = require('express-validator');

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const AADHAAR_REGEX = /^[2-9]{1}[0-9]{11}$/;
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const toBoolean = (value) => value === true || value === 'true';

const completeKycValidator = [
  body('companyName')
    .trim()
    .notEmpty()
    .withMessage('Company name is required.')
    .isLength({ min: 2, max: 150 })
    .withMessage('Company name must be between 2 and 150 characters.'),
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),
  body('panNumber')
    .trim()
    .notEmpty()
    .withMessage('PAN number is required.')
    .toUpperCase()
    .matches(PAN_REGEX)
    .withMessage('Please provide a valid PAN number (e.g., ABCDE1234F).'),
  body('isGstRegistered')
    .customSanitizer(toBoolean)
    .isBoolean()
    .withMessage('isGstRegistered must be true or false.'),
  body('gstNumber')
    .if((value, { req }) => toBoolean(req.body.isGstRegistered))
    .trim()
    .notEmpty()
    .withMessage('GST number is required for a GST-registered business.')
    .toUpperCase()
    .matches(GST_REGEX)
    .withMessage('Please provide a valid 15-character GST number.'),
  body('aadhaarNumber')
    .trim()
    .notEmpty()
    .withMessage('Aadhaar number is required.')
    .matches(AADHAAR_REGEX)
    .withMessage('Please provide a valid 12-digit Aadhaar number.'),
];

const updateProfileValidator = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters.'),
  body('companyName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 150 })
    .withMessage('Company name must be between 2 and 150 characters.'),
  body('email')
    .optional()
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),
];

const sendAadhaarOtpValidator = [
  body('aadhaarNumber')
    .trim()
    .notEmpty()
    .withMessage('Aadhaar number is required.')
    .matches(AADHAAR_REGEX)
    .withMessage('Please provide a valid 12-digit Aadhaar number.'),
];

const verifyAadhaarOtpValidator = [
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
  completeKycValidator,
  updateProfileValidator,
  sendAadhaarOtpValidator,
  verifyAadhaarOtpValidator,
};
