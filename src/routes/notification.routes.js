const express = require('express');
const notificationController = require('../controllers/notification.controller');
const authenticate = require('../middleware/auth.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const {
  registerDeviceTokenValidator,
  removeDeviceTokenValidator,
  sendTestNotificationValidator,
} = require('../validators/notification.validator');

const router = express.Router();

/**
 * @openapi
 * /notifications/device-token:
 *   post:
 *     tags: [Notifications]
 *     summary: Register (or reassign) this device's FCM token for push notifications
 *     description: Call on login and whenever the FCM SDK issues a new/refreshed token. Re-registering the same token just reassigns ownership to the current user.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, description: "FCM registration token from the client SDK" }
 *               platform: { type: string, enum: [ANDROID, IOS, WEB], default: ANDROID }
 *     responses:
 *       200: { description: Device registered successfully }
 *       422: { description: Validation failed }
 */
router.post(
  '/device-token',
  authenticate,
  registerDeviceTokenValidator,
  validateRequest,
  notificationController.registerDeviceToken
);

/**
 * @openapi
 * /notifications/device-token:
 *   delete:
 *     tags: [Notifications]
 *     summary: Unregister a device's FCM token (e.g. on logout)
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
 *       200: { description: Device unregistered successfully }
 *       422: { description: Validation failed }
 */
router.delete(
  '/device-token',
  authenticate,
  removeDeviceTokenValidator,
  validateRequest,
  notificationController.removeDeviceToken
);

/**
 * @openapi
 * /notifications/test:
 *   post:
 *     tags: [Notifications]
 *     summary: Send a test push notification to all of the caller's registered devices
 *     description: Useful for verifying FCM credentials/device registration end-to-end.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, body]
 *             properties:
 *               title: { type: string, example: "Test notification" }
 *               body: { type: string, example: "Hello from IVS backend" }
 *               data: { type: object, description: "Optional key/value payload delivered alongside the notification" }
 *     responses:
 *       200: { description: Notification sent (see response body for per-device success/failure counts) }
 *       422: { description: Validation failed }
 *       500: { description: FCM is not configured }
 */
router.post(
  '/test',
  authenticate,
  sendTestNotificationValidator,
  validateRequest,
  notificationController.sendTestNotification
);

module.exports = router;
