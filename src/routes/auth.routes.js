const express = require('express');
const authController = require('../controllers/auth.controller');
const authenticate = require('../middleware/auth.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { otpSendLimiter, otpVerifyLimiter } = require('../middleware/rateLimiter.middleware');
const {
  sendOtpValidator,
  verifyOtpValidator,
  refreshTokenValidator,
  logoutValidator,
} = require('../validators/auth.validator');

const router = express.Router();

/**
 * @openapi
 * /auth/send-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Send an OTP to a mobile number via MSG91
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mobile]
 *             properties:
 *               mobile: { type: string, example: "9876543210" }
 *               countryCode: { type: string, example: "+91" }
 *     responses:
 *       200: { description: OTP sent successfully }
 *       422: { description: Validation failed }
 */
router.post('/send-otp', otpSendLimiter, sendOtpValidator, validateRequest, authController.sendOtp);

/**
 * @openapi
 * /auth/verify-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Verify OTP and login/signup, returns access + refresh tokens
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mobile, otp, deviceId]
 *             properties:
 *               mobile: { type: string, example: "9876543210" }
 *               countryCode: { type: string, example: "+91" }
 *               otp: { type: string, example: "123456" }
 *               deviceId: { type: string, example: "device-uuid-1234" }
 *     responses:
 *       200: { description: Login successful }
 *       201: { description: Account created and logged in }
 *       422: { description: Validation failed }
 */
router.post('/verify-otp', otpVerifyLimiter, verifyOtpValidator, validateRequest, authController.verifyOtp);

/**
 * @openapi
 * /auth/refresh-token:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange a valid refresh token for a new access + refresh token pair
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken, deviceId]
 *             properties:
 *               refreshToken: { type: string }
 *               deviceId: { type: string }
 *     responses:
 *       200: { description: Access token refreshed successfully }
 *       401: { description: Invalid or expired refresh token }
 */
router.post('/refresh-token', refreshTokenValidator, validateRequest, authController.refreshToken);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Revoke the refresh token for the current device
 *     description: Pass `fcmToken` as well so the device stops receiving this user's push notifications — otherwise the next person to sign in on the same handset keeps getting them.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deviceId]
 *             properties:
 *               deviceId: { type: string }
 *               fcmToken: { type: string, description: The FCM registration token to unregister. Optional but strongly recommended. }
 *     responses:
 *       200: { description: Logged out successfully }
 *       401: { description: Unauthorized }
 */
router.post('/logout', authenticate, logoutValidator, validateRequest, authController.logout);

/**
 * @openapi
 * /auth/profile:
 *   get:
 *     tags: [Auth]
 *     summary: Get the currently authenticated user's profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile fetched successfully }
 *       401: { description: Unauthorized }
 */
router.get('/profile', authenticate, authController.getProfile);

module.exports = router;
