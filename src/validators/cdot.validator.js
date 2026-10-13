const { body } = require('express-validator');

const vendorRegisterValidator = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required.')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters.'),
  body('companyName')
    .trim()
    .notEmpty()
    .withMessage('Company name is required.')
    .isLength({ max: 100 })
    .withMessage('Company name must be 100 characters or fewer.'),
];

const vendorLoginValidator = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required.'),
];

const changePasswordValidator = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required.'),
  body('newPassword')
    .notEmpty()
    .withMessage('New password is required.')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters.')
    .custom((value, { req }) => {
      if (value === req.body.currentPassword) {
        throw new Error('New password must be different from current password.');
      }
      return true;
    }),
];

const checkImeiValidator = [
  body('imei')
    .trim()
    .notEmpty()
    .withMessage('IMEI is required.')
    .matches(/^\d{15}$/)
    .withMessage('IMEI must be exactly 15 digits.'),
];

module.exports = {
  vendorRegisterValidator,
  vendorLoginValidator,
  changePasswordValidator,
  checkImeiValidator,
};
