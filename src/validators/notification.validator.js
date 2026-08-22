const { body, param, query } = require('express-validator');
const { DEVICE_PLATFORM, NOTIFICATION_TYPE } = require('../constants/notification');

// FCM registration tokens are long opaque strings (~140+ chars today, but the
// format is not documented as stable). Bound the length rather than pattern
// match it: the goal is to reject an empty string or a whole JSON blob, not to
// second-guess Firebase's encoding.
const registerDeviceValidator = [
  body('token')
    .trim()
    .notEmpty()
    .withMessage('FCM token is required.')
    .bail()
    .isLength({ min: 20, max: 4096 })
    .withMessage('That does not look like a valid FCM registration token.'),
  body('platform')
    .trim()
    .notEmpty()
    .withMessage('Platform is required.')
    .bail()
    .toLowerCase()
    .isIn(Object.values(DEVICE_PLATFORM))
    .withMessage(`Platform must be one of: ${Object.values(DEVICE_PLATFORM).join(', ')}.`),
  body('appVersion').optional({ values: 'falsy' }).trim().isLength({ max: 32 }),
  body('deviceId').optional({ values: 'falsy' }).trim().isLength({ max: 128 }),
  body('deviceModel').optional({ values: 'falsy' }).trim().isLength({ max: 128 }),
  body('osVersion').optional({ values: 'falsy' }).trim().isLength({ max: 64 }),
];

const unregisterDeviceValidator = [
  body('token').trim().notEmpty().withMessage('FCM token is required.'),
];

const listNotificationsValidator = [
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be a positive integer.'),
  query('limit')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be between 1 and 100.'),
  query('type')
    .optional({ values: 'falsy' })
    .isIn(Object.values(NOTIFICATION_TYPE))
    .withMessage('Unknown notification type.'),
];

const notificationIdParamValidator = [
  param('notificationId').isMongoId().withMessage('A valid notification id is required.'),
];

module.exports = {
  registerDeviceValidator,
  unregisterDeviceValidator,
  listNotificationsValidator,
  notificationIdParamValidator,
};
