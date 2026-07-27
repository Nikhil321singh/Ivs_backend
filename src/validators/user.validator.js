const { body } = require('express-validator');
const USER_TYPE = require('../constants/userType');
const MESSAGES = require('../constants/messages');

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const AADHAAR_REGEX = /^[2-9]{1}[0-9]{11}$/;
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const MOBILE_REGEX = /^[6-9]\d{9}$/;

const isVendor = (req) => req.body.userType === USER_TYPE.VENDOR;
const isIndividual = (req) => req.body.userType === USER_TYPE.INDIVIDUAL;

/**
 * KYC has two shapes keyed off userType:
 *   - vendor:     companyName, email, panNumber, gstNumber (always), owner
 *                 image (profileImage). Identified by GST — no Aadhaar.
 *   - individual: name, email, panNumber, aadhaarNumber. Identified by
 *                 Aadhaar (verified via OTP beforehand) — no GST, no image.
 * Shared fields (phone, email, panNumber) are validated unconditionally; the
 * rest apply only to their type via `.if()`.
 */
const completeKycValidator = [
  body('userType')
    .trim()
    .isIn(Object.values(USER_TYPE))
    .withMessage(MESSAGES.USER.USER_TYPE_INVALID),

  // Shared
  body('phone')
    .trim()
    .notEmpty()
    .withMessage('Phone number is required.')
    .matches(MOBILE_REGEX)
    .withMessage('Please provide a valid 10-digit phone number.'),
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

  // Vendor-only
  body('companyName')
    .if((value, { req }) => isVendor(req))
    .trim()
    .notEmpty()
    .withMessage('Business name is required.')
    .isLength({ min: 2, max: 150 })
    .withMessage('Business name must be between 2 and 150 characters.'),
  body('gstNumber')
    .if((value, { req }) => isVendor(req))
    .trim()
    .notEmpty()
    .withMessage('GST number is required for a vendor.')
    .toUpperCase()
    .matches(GST_REGEX)
    .withMessage('Please provide a valid 15-character GST number.'),
  // Owner image arrives as a file (multer), so validate req.file here.
  body('profileImage').custom((value, { req }) => {
    if (isVendor(req) && !req.file) {
      throw new Error(MESSAGES.USER.OWNER_IMAGE_REQUIRED);
    }
    return true;
  }),

  // Individual-only
  body('name')
    .if((value, { req }) => isIndividual(req))
    .trim()
    .notEmpty()
    .withMessage('Name is required.')
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters.'),
  body('aadhaarNumber')
    .if((value, { req }) => isIndividual(req))
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
