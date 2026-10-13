const { body, param } = require('express-validator');

const createVendorValidator = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),
  body('companyName')
    .trim()
    .notEmpty()
    .withMessage('Company name is required.')
    .isLength({ max: 100 })
    .withMessage('Company name must be 100 characters or fewer.'),
  body('initialWalletBalance')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Initial wallet balance must be a positive whole number.')
    .toInt(),
];

const vendorIdParamValidator = [
  param('vendorId').isMongoId().withMessage('A valid vendor ID is required.'),
];

const adjustWalletValidator = [
  ...vendorIdParamValidator,
  body('amount')
    .notEmpty()
    .withMessage('Amount is required.')
    .isInt()
    .withMessage('Amount must be a whole number (positive to credit, negative to debit).')
    .toInt()
    .custom((value) => {
      if (value === 0) {
        throw new Error('Amount cannot be zero.');
      }
      return true;
    }),
  body('reason')
    .trim()
    .notEmpty()
    .withMessage('Reason is required.')
    .isLength({ max: 200 })
    .withMessage('Reason must be 200 characters or fewer.'),
];

module.exports = {
  createVendorValidator,
  vendorIdParamValidator,
  adjustWalletValidator,
};
