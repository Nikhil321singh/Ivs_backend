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
const strictKycChain = [
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
  // `req.aadhaarRequired` is set by loadPolicy, mounted ahead of this chain.
  // While the admin kill switch is off the field becomes optional, so an
  // individual can complete KYC without an Aadhaar number at all. It is still
  // format-checked when supplied.
  body('aadhaarNumber')
    .if((value, { req }) => isIndividual(req) && req.aadhaarRequired !== false)
    .trim()
    .notEmpty()
    .withMessage('Aadhaar number is required.')
    .matches(AADHAAR_REGEX)
    .withMessage('Please provide a valid 12-digit Aadhaar number.'),
  body('aadhaarNumber')
    .if((value, { req }) => isIndividual(req) && req.aadhaarRequired === false)
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
