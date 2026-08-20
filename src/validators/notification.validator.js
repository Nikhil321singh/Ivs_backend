const { body } = require('express-validator');
const DeviceToken = require('../models/DeviceToken.model');

const registerDeviceTokenValidator = [
  body('token').trim().notEmpty().withMessage('FCM device token is required.'),
  body('platform')
    .optional()
    .trim()
    .isIn(Object.values(DeviceToken.PLATFORM))
    .withMessage(`Platform must be one of: ${Object.values(DeviceToken.PLATFORM).join(', ')}.`),
];

const removeDeviceTokenValidator = [
  body('token').trim().notEmpty().withMessage('FCM device token is required.'),
];

const sendTestNotificationValidator = [
  body('title').trim().notEmpty().withMessage('Title is required.'),
  body('body').trim().notEmpty().withMessage('Body is required.'),
  body('data').optional().isObject().withMessage('Data must be an object of string key/value pairs.'),
];

module.exports = {
  registerDeviceTokenValidator,
  removeDeviceTokenValidator,
  sendTestNotificationValidator,
};
