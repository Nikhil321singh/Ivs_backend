const { body, param } = require('express-validator');
const { SETTING_DEFINITIONS } = require('../../constants/settings');
const {
  NOTIFICATION_TYPE,
  AUDIENCE_MODE,
  DEVICE_PLATFORM,
} = require('../../constants/notification');
const USER_TYPE = require('../../constants/userType');

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

// Rejects a malformed id up front with a 422 carrying a field name, rather
// than letting Mongoose raise a CastError that surfaces as a bare 400.
const userIdParamValidator = [
  param('userId').isMongoId().withMessage('A valid user id is required.'),
];

/**
 * A broadcast from the console.
 *
 * The audience modes an admin may pick here are ALL, USER_IDS and FILTER.
 * OUTDATED_APP is deliberately absent: it needs a published release to compare
 * against, so it is only reachable through the app-update endpoint, which has
 * that release in hand.
 */
const BROADCAST_AUDIENCE_MODES = [
  AUDIENCE_MODE.ALL,
  AUDIENCE_MODE.USER_IDS,
  AUDIENCE_MODE.FILTER,
];

const MONGO_ID = /^[0-9a-fA-F]{24}$/;

const sendNotificationValidator = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required.')
    .bail()
    // Android truncates a notification title around 65 characters and iOS
    // around 40. 120 leaves room for the inbox copy while still refusing an
    // entire paragraph pasted into the wrong field.
    .isLength({ max: 120 })
    .withMessage('Title must be 120 characters or fewer.'),
  body('body')
    .trim()
    .notEmpty()
    .withMessage('Message body is required.')
    .bail()
    .isLength({ max: 500 })
    .withMessage('Message body must be 500 characters or fewer.'),
  body('type')
    .optional({ values: 'falsy' })
    .isIn(Object.values(NOTIFICATION_TYPE))
    .withMessage(`Type must be one of: ${Object.values(NOTIFICATION_TYPE).join(', ')}.`),
  body('imageUrl')
    .optional({ values: 'falsy' })
    .trim()
    .isURL({ require_protocol: true })
    .withMessage('imageUrl must be a full URL including https://'),
  body('data')
    .optional()
    .custom((value) => {
      if (typeof value !== 'object' || Array.isArray(value) || value === null) {
        throw new Error('data must be an object of key/value pairs.');
      }
      return true;
    }),
  body('audience')
    .optional()
    .custom((audience) => {
      if (typeof audience !== 'object' || Array.isArray(audience) || audience === null) {
        throw new Error('audience must be an object.');
      }

      const mode = audience.mode || AUDIENCE_MODE.ALL;

      if (!BROADCAST_AUDIENCE_MODES.includes(mode)) {
        throw new Error(`audience.mode must be one of: ${BROADCAST_AUDIENCE_MODES.join(', ')}.`);
      }

      if (mode === AUDIENCE_MODE.USER_IDS) {
        const ids = audience.userIds;
        if (!Array.isArray(ids) || ids.length === 0) {
          throw new Error('audience.userIds must be a non-empty array for mode USER_IDS.');
        }
        // Caught here rather than by Mongo, so one mistyped id reports itself
        // instead of failing the whole send with a CastError.
        if (!ids.every((id) => MONGO_ID.test(String(id)))) {
          throw new Error('audience.userIds must all be valid user ids.');
        }
      }

      if (mode === AUDIENCE_MODE.FILTER) {
        const filter = audience.filter || {};
        if (filter.userType && !Object.values(USER_TYPE).includes(filter.userType)) {
          throw new Error(`audience.filter.userType must be one of: ${Object.values(USER_TYPE).join(', ')}.`);
        }
        if (filter.platform && !Object.values(DEVICE_PLATFORM).includes(filter.platform)) {
          throw new Error(`audience.filter.platform must be one of: ${Object.values(DEVICE_PLATFORM).join(', ')}.`);
        }
        if (
          filter.kycCompleted !== undefined &&
          typeof filter.kycCompleted !== 'boolean' &&
          !['true', 'false'].includes(String(filter.kycCompleted))
        ) {
          throw new Error('audience.filter.kycCompleted must be true or false.');
        }
      }

      return true;
    }),
];

const campaignIdParamValidator = [
  param('campaignId').isMongoId().withMessage('A valid campaign id is required.'),
];

module.exports = {
  loginValidator,
  updateSettingsValidator,
  userIdParamValidator,
  sendNotificationValidator,
  campaignIdParamValidator,
};
