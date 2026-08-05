const { body } = require('express-validator');

const IMEI_REGEX = /^\d{15}$/;

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

module.exports = { diagnoseValidator };
