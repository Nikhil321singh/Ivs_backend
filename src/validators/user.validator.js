const { body } = require('express-validator');
const USER_TYPE = require('../constants/userType');
const MESSAGES = require('../constants/messages');

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const AADHAAR_REGEX = /^[2-9]{1}[0-9]{11}$/;
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const MOBILE_REGEX = /^[6-9]\d{9}$/;

// A body with no userType is treated as an individual, matching the same
// fallback completeKyc applies when it resolves the type. Compared
// case-insensitively so a client sending "Vendor" or "VENDOR" is still a
// vendor — otherwise it lands in the individual branch and is asked for a
// name and PAN it was never meant to collect.
const normalizeType = (value) => String(value ?? '').trim().toLowerCase();
const isVendor = (req) => normalizeType(req.body.userType) === USER_TYPE.VENDOR;
const isIndividual = (req) => !isVendor(req);

// Applied to userType before isIn() so the stored value is canonical too —
// completeKyc writes req.body.userType straight onto the user.
const userTypeSanitizer = (value) => (value === undefined ? value : normalizeType(value));

/**
 * KYC required fields, keyed off userType:
 *   - individual: name, email, PAN
 *   - vendor:     companyName, email
 *
 * Email is the only field both must supply. A vendor is identified by its
 * business, so it is not forced to give a personal name or a PAN; an individual
 * has no business name to give. Neither is forced through the Aadhaar OTP step,
 * and a vendor is not forced to supply GST or an owner photo.
 *
 * Everything not required is still format-checked when supplied, so a typo'd
 * PAN or GST is rejected rather than silently stored.
 */
const strictKycChain = [
  body('userType')
    .optional({ checkFalsy: true })
    .trim()
    .customSanitizer(userTypeSanitizer)
    .isIn(Object.values(USER_TYPE))
    .withMessage(MESSAGES.USER.USER_TYPE_INVALID),

  // Required of both types.
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),

  // Individual only. Name is optional — only its format is checked when supplied.
  body('name')
    .if((value, { req }) => isIndividual(req))
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters.'),
  body('panNumber')
    .if((value, { req }) => isIndividual(req))
    .trim()
    .notEmpty()
    .withMessage('PAN number is required.')
    .toUpperCase()
    .matches(PAN_REGEX)
    .withMessage('Please provide a valid PAN number (e.g., ABCDE1234F).'),

  // Vendor only.
  body('companyName')
    .if((value, { req }) => isVendor(req))
    .trim()
    .notEmpty()
    .withMessage('Business name is required.')
    .isLength({ min: 2, max: 150 })
    .withMessage('Business name must be between 2 and 150 characters.'),

  // Optional — accepted when the client collects them, validated if present.
  body('phone')
    .optional({ checkFalsy: true })
    .trim()
    .matches(MOBILE_REGEX)
    .withMessage('Please provide a valid 10-digit phone number.'),
  body('name')
    .if((value, { req }) => isVendor(req))
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters.'),
  body('panNumber')
    .if((value, { req }) => isVendor(req))
    .optional({ checkFalsy: true })
    .trim()
    .toUpperCase()
    .matches(PAN_REGEX)
    .withMessage('Please provide a valid PAN number (e.g., ABCDE1234F).'),
  body('companyName')
    .if((value, { req }) => isIndividual(req))
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 150 })
    .withMessage('Business name must be between 2 and 150 characters.'),
  body('gstNumber')
    .optional({ checkFalsy: true })
    .trim()
    .toUpperCase()
    .matches(GST_REGEX)
    .withMessage('Please provide a valid 15-character GST number.'),
  body('businessProofType')
    .optional({ checkFalsy: true })
    .trim()
    .toLowerCase()
    .isIn(['gstin', 'udyam'])
    .withMessage('Business proof must be a GSTIN or Udyam Aadhaar.'),
  body('aadhaarNumber')
    .optional({ checkFalsy: true })
    .trim()
    .matches(AADHAAR_REGEX)
    .withMessage('Please provide a valid 12-digit Aadhaar number.'),
];

/**
 * Used instead of strictKycChain while the "KYC required" switch is off:
 * nothing is mandatory, but anything supplied must still be well-formed, so a
 * typo'd PAN is caught rather than silently stored.
 */
const relaxedKycChain = [
  body('userType')
    .optional({ checkFalsy: true })
    .trim()
    .customSanitizer(userTypeSanitizer)
    .isIn(Object.values(USER_TYPE))
    .withMessage(MESSAGES.USER.USER_TYPE_INVALID),
  body('name')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters.'),
  body('companyName')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 150 })
    .withMessage('Company name must be between 2 and 150 characters.'),
  body('phone')
    .optional({ checkFalsy: true })
    .trim()
    .matches(MOBILE_REGEX)
    .withMessage('Please provide a valid 10-digit phone number.'),
  body('email')
    .optional({ checkFalsy: true })
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),
  body('panNumber')
    .optional({ checkFalsy: true })
    .trim()
    .toUpperCase()
    .matches(PAN_REGEX)
    .withMessage('Please provide a valid PAN number.'),
  body('gstNumber')
    .optional({ checkFalsy: true })
    .trim()
    .toUpperCase()
    .matches(GST_REGEX)
    .withMessage('Please provide a valid GST number.'),
  body('businessProofType')
    .optional({ checkFalsy: true })
    .trim()
    .toLowerCase()
    .isIn(['gstin', 'udyam'])
    .withMessage('Business proof must be a GSTIN or Udyam Aadhaar.'),
  body('aadhaarNumber')
    .optional({ checkFalsy: true })
    .trim()
    .matches(AADHAAR_REGEX)
    .withMessage('Please provide a valid 12-digit Aadhaar number.'),
];

/**
 * Picks the chain at request time. express-validator chains expose `.run(req)`,
 * so they can be executed imperatively — which is the only way to choose
 * between two chains based on an async setting. Errors land in the same place,
 * so validateRequest downstream is unchanged.
 */
const completeKycValidator = async (req, res, next) => {
  const chain = req.kycRequired === false ? relaxedKycChain : strictKycChain;

  try {
    for (const validator of chain) {
      // Sequential, not Promise.all: sanitizers mutate req.body and later
      // `.if()` predicates read it.
      // eslint-disable-next-line no-await-in-loop
      await validator.run(req);
    }
    next();
  } catch (err) {
    next(err);
  }
};

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

// Same reasoning as the customer/IVS pair in ivs.validator.js: while the
// Aadhaar kill switch is off these endpoints succeed without contacting UIDAI,
// so requiring a well-formed Aadhaar or OTP would 422 a client that has
// correctly stopped collecting them. Format is still enforced when supplied.
const sendAadhaarOtpValidator = [
  body('aadhaarNumber')
    .if((value, { req }) => req.aadhaarRequired !== false)
    .trim()
    .notEmpty()
    .withMessage('Aadhaar number is required.')
    .matches(AADHAAR_REGEX)
    .withMessage('Please provide a valid 12-digit Aadhaar number.'),
  body('aadhaarNumber')
    .if((value, { req }) => req.aadhaarRequired === false)
    .optional({ checkFalsy: true })
    .trim()
    .matches(AADHAAR_REGEX)
    .withMessage('Please provide a valid 12-digit Aadhaar number.'),
];

const verifyAadhaarOtpValidator = [
  body('otp')
    .if((value, { req }) => req.aadhaarRequired !== false)
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
