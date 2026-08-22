const express = require('express');
const notificationController = require('../controllers/notification.controller');
const authenticate = require('../middleware/auth.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const {
  registerDeviceValidator,
  unregisterDeviceValidator,
  listNotificationsValidator,
  notificationIdParamValidator,
} = require('../validators/notification.validator');

const router = express.Router();

/**
 * @openapi
 * /notifications/devices:
 *   post:
 *     tags: [Notifications]
 *     summary: Register this device's FCM token
 *     description: >-
 *       Call after every sign-in and whenever Firebase hands the app a new token
 *       (`onTokenRefresh`). Idempotent — re-sending the same token updates the
 *       existing registration instead of creating another, so the device never
 *       receives duplicate pushes. If the token was previously registered to a
 *       different account (same handset, new sign-in) it is reassigned to the
 *       caller, and the previous account stops receiving notifications on it.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, platform]
 *             properties:
 *               token: { type: string, description: FCM registration token, example: "fMEP0vJ...long-token" }
 *               platform: { type: string, enum: [android, ios, web], example: android }
 *               appVersion: { type: string, example: "1.4.2", description: "Drives the outdated-app audience for update notices." }
 *               deviceId: { type: string, example: "d41d8cd98f00b204" }
 *               deviceModel: { type: string, example: "Pixel 7a" }
 *               osVersion: { type: string, example: "Android 14" }
 *     responses:
 *       200:
 *         description: Device registered for notifications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     device: { type: object }
 *                     pushEnabled:
 *                       type: boolean
 *                       description: False when the server has no Firebase credentials — notifications are still stored in the inbox but no push is delivered.
 *       401: { description: Unauthorized }
 *       422: { description: Validation failed }
 */
router.post(
  '/devices',
  authenticate,
  registerDeviceValidator,
  validateRequest,
  notificationController.registerDevice
);

/**
 * @openapi
 * /notifications/devices:
 *   get:
 *     tags: [Notifications]
 *     summary: My registered devices
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Registered devices fetched successfully }
 *   delete:
 *     tags: [Notifications]
 *     summary: Unregister a device token
 *     description: Call on sign-out, so notifications stop reaching a handset the user no longer holds.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200: { description: Device removed from notifications }
 *       401: { description: Unauthorized }
 */
router.get('/devices', authenticate, notificationController.listDevices);
router.delete(
  '/devices',
  authenticate,
  unregisterDeviceValidator,
  validateRequest,
  notificationController.unregisterDevice
);

/**
 * @openapi
 * /notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: My notification inbox, newest first
 *     description: >-
 *       Every notification is stored here whether or not the push reached the
 *       device, so this — not FCM — is the record of what the user was told.
 *       `unreadCount` is returned alongside the page so a badge needs no second
 *       request.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *       - { in: query, name: unreadOnly, schema: { type: boolean } }
 *       - { in: query, name: type, schema: { type: string, enum: [APP_UPDATE, PROMOTIONAL, TRANSACTIONAL, WALLET, KYC, IVS, SYSTEM] } }
 *     responses:
 *       200:
 *         description: Notifications fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string }
 *                           title: { type: string }
 *                           body: { type: string }
 *                           type: { type: string }
 *                           data: { type: object, description: "Client routing payload, e.g. { screen: 'AppUpdate', storeUrl: '...' }" }
 *                           imageUrl: { type: string, nullable: true }
 *                           isRead: { type: boolean }
 *                           readAt: { type: string, format: date-time, nullable: true }
 *                           createdAt: { type: string, format: date-time }
 *                     unreadCount: { type: integer }
 *                     pagination: { type: object }
 *       401: { description: Unauthorized }
 */
router.get(
  '/',
  authenticate,
  listNotificationsValidator,
  validateRequest,
  notificationController.list
);

/**
 * @openapi
 * /notifications/unread-count:
 *   get:
 *     tags: [Notifications]
 *     summary: Unread badge count
 *     description: Cheap enough to poll — backed by a partial index over unread rows only.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Unread notification count fetched successfully }
 */
router.get('/unread-count', authenticate, notificationController.unreadCount);

/**
 * @openapi
 * /notifications/read-all:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark every notification read
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: All notifications marked as read }
 */
router.patch('/read-all', authenticate, notificationController.markAllRead);

/**
 * @openapi
 * /notifications/{notificationId}/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark one notification read
 *     description: Idempotent — marking an already-read notification returns it unchanged rather than failing.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: notificationId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Notification marked as read }
 *       404: { description: Notification not found }
 */
router.patch(
  '/:notificationId/read',
  authenticate,
  notificationIdParamValidator,
  validateRequest,
  notificationController.markRead
);

/**
 * @openapi
 * /notifications/{notificationId}:
 *   delete:
 *     tags: [Notifications]
 *     summary: Delete a notification from my inbox
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: notificationId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Notification deleted successfully }
 *       404: { description: Notification not found }
 */
router.delete(
  '/:notificationId',
  authenticate,
  notificationIdParamValidator,
  validateRequest,
  notificationController.remove
);

module.exports = router;
