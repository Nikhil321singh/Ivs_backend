const { body } = require('express-validator');

const analyzeFaultValidator = [
  body('query')
    .trim()
    .notEmpty()
    .withMessage('Device description (query) is required.')
    .isLength({ min: 5, max: 1000 })
    .withMessage('Query must be between 5 and 1000 characters.'),
];

const chatRepairValidator = [
  body('message')
    .trim()
    .notEmpty()
    .withMessage('Message is required.')
    .isLength({ min: 1, max: 2000 })
    .withMessage('Message must be between 1 and 2000 characters.'),
  body('context')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 4000 })
    .withMessage('Context must be max 4000 characters.'),
];

module.exports = {
  analyzeFaultValidator,
  chatRepairValidator,
};
