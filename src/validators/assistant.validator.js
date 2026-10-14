const { body } = require('express-validator');

// The assistant takes a short conversation: an array of {role, content} turns.
// Depth/length are bounded again in assistant.service.js; this is the first,
// cheap gate.
const chatValidator = [
  body('messages')
    .isArray({ min: 1, max: 20 })
    .withMessage('messages must be an array of 1–20 turns.'),
  body('messages.*.role')
    .isIn(['user', 'assistant'])
    .withMessage("Each message role must be 'user' or 'assistant'."),
  body('messages.*.content')
    .isString()
    .withMessage('Each message must have string content.')
    .bail()
    .trim()
    .isLength({ min: 1, max: 4000 })
    .withMessage('Each message must be 1–4000 characters.'),
];

module.exports = { chatValidator };
