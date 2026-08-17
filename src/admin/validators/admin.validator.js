const { body } = require('express-validator');
const { SETTING_DEFINITIONS } = require('../../constants/settings');

const loginValidator = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required.'),
];

// The body is a partial settings patch: every key must be a known setting and
// carry the declared type. Unknown keys are rejected outright rather than
// silently dropped, so a typo in the portal surfaces instead of doing nothing.
const updateSettingsValidator = [
  body().custom((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Request body must be an object of settings.');
    }

    const keys = Object.keys(value);

    if (keys.length === 0) {
      throw new Error('At least one setting must be provided.');
    }

    keys.forEach((key) => {
      const definition = SETTING_DEFINITIONS[key];

      if (!definition) {
        throw new Error(`Unknown setting: ${key}`);
      }

      if (definition.type === 'boolean' && typeof value[key] !== 'boolean') {
        throw new Error(`Setting ${key} must be true or false.`);
      }

      if (definition.type === 'integer') {
        const parsed = Number(value[key]);

        if (!Number.isInteger(parsed)) {
          throw new Error(`Setting ${key} must be a whole number.`);
        }
        // Reject out-of-range here rather than letting the service clamp it, so
        // the operator is told their price was refused instead of silently
        // saving a different one.
        if (definition.min !== undefined && parsed < definition.min) {
          throw new Error(`Setting ${key} must be at least ${definition.min}.`);
        }
        if (definition.max !== undefined && parsed > definition.max) {
          throw new Error(`Setting ${key} must be at most ${definition.max}.`);
        }
      }
    });

    return true;
  }),
];

module.exports = { loginValidator, updateSettingsValidator };
