const { body } = require('express-validator');

const IMEI_REGEX = /^\d{15}$/;

const verifyImeiValidator = [
  body('imei1')
    .trim()
    .notEmpty()
    .withMessage('IMEI 1 is required.')
    .matches(IMEI_REGEX)
    .withMessage('IMEI 1 must be exactly 15 numeric digits.'),
  body('imei2')
    .optional({ checkFalsy: true })
    .trim()
    .matches(IMEI_REGEX)
    .withMessage('IMEI 2 must be exactly 15 numeric digits.')
    .custom((value, { req }) => value !== req.body.imei1)
    .withMessage('IMEI 1 and IMEI 2 must be different.'),
  body('deviceModel')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 200 })
    .withMessage('Device model must be at most 200 characters.'),
];

module.exports = { verifyImeiValidator };
