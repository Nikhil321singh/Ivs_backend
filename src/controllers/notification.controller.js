const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const notificationService = require('../services/notification.service');
const deviceTokenService = require('../services/deviceToken.service');
const fcmProvider = require('../services/providers/fcmProvider');

/**
 * Registers (or refreshes) the caller's FCM token.
 *
 * The app calls this after every sign-in and whenever Firebase hands it a new
 * token. `pushEnabled` tells the client whether this server can actually
 * deliver — useful for hiding a "notifications are on" tick that would be a lie
 * on a deployment without Firebase credentials.
 */
const registerDevice = asyncHandler(async (req, res) => {
  const device = await deviceTokenService.register(req.user.id, req.body);

  successResponse(res, httpStatus.OK, MESSAGES.NOTIFICATION.DEVICE_REGISTERED, {
    device,
    pushEnabled: fcmProvider.isConfigured(),
  });
});

/**
 * Retires one token. The app calls this on sign-out so the next person to hold
 * the handset does not get the previous user's notifications.
 */
const unregisterDevice = asyncHandler(async (req, res) => {
  const removed = await deviceTokenService.deactivate(req.user.id, req.body.token);

  successResponse(res, httpStatus.OK, MESSAGES.NOTIFICATION.DEVICE_REMOVED, { removed });
});

const listDevices = asyncHandler(async (req, res) => {
  const devices = await deviceTokenService.listForUser(req.user.id);

  successResponse(res, httpStatus.OK, MESSAGES.NOTIFICATION.DEVICES_FETCHED, { devices });
});

const list = asyncHandler(async (req, res) => {
  const data = await notificationService.listForUser(req.user.id, req.query);

  successResponse(res, httpStatus.OK, MESSAGES.NOTIFICATION.FETCHED, data);
});

/** The badge count. Its own endpoint so the app can poll it cheaply. */
const unreadCount = asyncHandler(async (req, res) => {
  const count = await notificationService.unreadCount(req.user.id);

  successResponse(res, httpStatus.OK, MESSAGES.NOTIFICATION.UNREAD_COUNT_FETCHED, { count });
});

const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markRead(req.user.id, req.params.notificationId);

  successResponse(res, httpStatus.OK, MESSAGES.NOTIFICATION.MARKED_READ, { notification });
});

const markAllRead = asyncHandler(async (req, res) => {
  const updated = await notificationService.markAllRead(req.user.id);

  successResponse(res, httpStatus.OK, MESSAGES.NOTIFICATION.ALL_MARKED_READ, { updated });
});

const remove = asyncHandler(async (req, res) => {
  await notificationService.remove(req.user.id, req.params.notificationId);

  successResponse(res, httpStatus.OK, MESSAGES.NOTIFICATION.DELETED, {});
});

module.exports = {
  registerDevice,
  unregisterDevice,
  listDevices,
  list,
  unreadCount,
  markRead,
  markAllRead,
  remove,
};
