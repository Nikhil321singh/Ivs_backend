const { body } = require('express-validator');

const topupOrderValidator = [
  body('amount')
    .notEmpty()
    .withMessage('Amount is required.')
    .bail()
    .isInt({ min: 1 })
    .withMessage('Amount must be a positive whole number (in ₹).')
    .toInt(),
];

const verifyPaymentValidator = [
  body('orderId').trim().notEmpty().withMessage('orderId is required.'),
  body('paymentId').trim().notEmpty().withMessage('paymentId is required.'),
  body('signature').trim().notEmpty().withMessage('signature is required.'),
];

module.exports = { topupOrderValidator, verifyPaymentValidator };
