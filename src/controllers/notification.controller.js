const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const notificationService = require('../services/notification.service');

const registerDeviceToken = asyncHandler(async (req, res) => {
  await notificationService.registerDeviceToken(req.user.id, req.body);

  successResponse(res, httpStatus.OK, MESSAGES.NOTIFICATION.TOKEN_REGISTERED);
});

const removeDeviceToken = asyncHandler(async (req, res) => {
  await notificationService.removeDeviceToken(req.user.id, req.body.token);

  successResponse(res, httpStatus.OK, MESSAGES.NOTIFICATION.TOKEN_REMOVED);
});

const sendTestNotification = asyncHandler(async (req, res) => {
  const result = await notificationService.sendToUser(req.user.id, req.body);

  successResponse(res, httpStatus.OK, MESSAGES.NOTIFICATION.TEST_SENT, result);
});

module.exports = { registerDeviceToken, removeDeviceToken, sendTestNotification };
