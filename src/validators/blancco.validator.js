const { body } = require('express-validator');

const IMEI_REGEX = /^\d{15}$/;
const MOBILE_REGEX = /^[6-9]\d{9}$/;
const AADHAAR_REGEX = /^[2-9]{1}[0-9]{11}$/;

const createSessionValidator = [
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

  body('aadhaarNumber')
    .optional({ checkFalsy: true })
    .trim()
    .matches(AADHAAR_REGEX)
    .withMessage('Please provide a valid 12-digit Aadhaar number.'),

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

  body('deviceBrand')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 100 })
    .withMessage('Device brand must be at most 100 characters.'),

  body('price')
    .notEmpty()
    .withMessage('Price is required.')
    .bail()
    .isFloat({ min: 0 })
    .withMessage('Price must be a non-negative amount.')
    .toFloat(),
];

module.exports = { createSessionValidator };
