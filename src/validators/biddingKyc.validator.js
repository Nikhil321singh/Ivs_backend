const { body } = require('express-validator');

const submitBiddingKycValidator = [
  body('shopAddress')
    .trim()
    .notEmpty()
    .withMessage('Shop address is required.'),
  body('shopVisitingCardNumber')
    .trim()
    .notEmpty()
    .withMessage('Shop visiting card number is required.'),
  body('googleMapLink')
    .trim()
    .notEmpty()
    .withMessage('Google Maps link is required.'),
  body('gstNumber')
    .trim()
    .notEmpty()
    .withMessage('GST number is required.')
    .matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .withMessage('Please provide a valid GST number.'),
];

module.exports = { submitBiddingKycValidator };
