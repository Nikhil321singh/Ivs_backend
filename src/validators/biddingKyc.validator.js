const { body } = require('express-validator');

const submitBiddingKycValidator = [
  body('shopAddress')
    .trim()
    .notEmpty()
    .withMessage('Shop address is required.'),
  // Shop number / Maps link / GST number are optional — the app collects only
  // the address + a document photo now. When sent, GST (if any) must be well-formed.
  body('gstNumber')
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .withMessage('Please provide a valid GST number.'),
];

module.exports = { submitBiddingKycValidator };
