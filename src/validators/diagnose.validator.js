const { body } = require('express-validator');

const IMEI_REGEX = /^\d{15}$/;
const MOBILE_REGEX = /^[6-9]\d{9}$/;
const AADHAAR_REGEX = /^[2-9]{1}[0-9]{11}$/;

// Placeholder validation — tighten once the third-party diagnose contract is
// finalised (see services/providers/diagnoseProvider.js).
const diagnoseValidator = [
  body('imei')
    .optional({ checkFalsy: true })
    .trim()
    .matches(IMEI_REGEX)
    .withMessage('IMEI must be exactly 15 numeric digits.'),
  body('deviceModel')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 200 })
    .withMessage('Device model must be at most 200 characters.'),
];

// A report is accepted either as free text or as the structured output of a
// diagnosis tool, so the check is "present and carries something" rather than a
// type assertion — an empty string, [] or {} is a caller mistake, not a record.
const isNonEmptyReport = (value) => {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return false;
};

/**
 * Fields for a stored diagnosis record. Name, phone, report and price are the
 * record — without them there is nothing worth keeping — so they are required;
 * email and Aadhaar are format-checked when supplied but never demanded, since
 * a walk-in customer may not give either.
 */
const diagnoseRecordValidator = [
  body('customerName')
    .trim()
    .notEmpty()
    .withMessage('Customer name is required.')
    .isLength({ min: 2, max: 100 })
    .withMessage('Customer name must be between 2 and 100 characters.'),

  body('customerPhone')
    .trim()
    .notEmpty()
    .withMessage('Customer phone number is required.')
    .matches(MOBILE_REGEX)
    .withMessage('Please provide a valid 10-digit mobile number.'),

  body('customerEmail')
    .optional({ checkFalsy: true })
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),

  // Validated in full so a typo is caught, then masked before storage — the
  // full number is never persisted. See services/diagnose.service.js.
  body('aadhaarNumber')
    .optional({ checkFalsy: true })
    .trim()
    .matches(AADHAAR_REGEX)
    .withMessage('Please provide a valid 12-digit Aadhaar number.'),

  // Optional for the reasons given on the model: no handset in hand yet, or a
  // device that has no IMEI. Format-checked when supplied so a mistyped one is
  // caught at the edge rather than stored and puzzled over later.
  body('imei')
    .optional({ checkFalsy: true })
    .trim()
    .matches(IMEI_REGEX)
    .withMessage('IMEI must be exactly 15 numeric digits.'),

  body('deviceModel')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 200 })
    .withMessage('Device model must be at most 200 characters.'),

  body('report')
    .custom(isNonEmptyReport)
    .withMessage('Diagnosis report is required.'),

  // Rupees charged to the customer. 0 is allowed — a free check is still a
  // record worth keeping.
  body('price')
    .notEmpty()
    .withMessage('Price is required.')
    .bail()
    .isFloat({ min: 0 })
    .withMessage('Price must be a non-negative amount.')
    .toFloat(),

  body('diagnosedAt')
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage('Diagnosis time must be a valid ISO 8601 date.')
    .toDate(),
];

module.exports = { diagnoseValidator, diagnoseRecordValidator };
