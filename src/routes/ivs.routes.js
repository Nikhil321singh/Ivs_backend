const express = require('express');
const ivsController = require('../controllers/ivs.controller');
const authenticate = require('../middleware/auth.middleware');
const requireBalance = require('../middleware/requireBalance.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { imeiVerificationLimiter } = require('../middleware/rateLimiter.middleware');
const loadPolicy = require('../middleware/policy.middleware');
const {
  normalizeImeiBody,
  verifyImeiValidator,
  customerAadhaarSendOtpValidator,
  customerAadhaarVerifyOtpValidator,
} = require('../validators/ivs.validator');

const router = express.Router();

/**
 * @openapi
 * /ivs/verify:
 *   post:
 *     tags: [IVS]
 *     summary: Verify device IMEI(s) against C-DOT's CEIR blocklist
 *     description: Never returns an error status for a blocked/stolen/unverifiable device — check allowTransaction and imei1Status/imei2Status in the response instead.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [imei1]
 *             properties:
 *               imei1: { type: string, example: "355301083783251" }
 *               imei2: { type: string, example: "123456789012346" }
 *               imei: { type: string, description: "Alias for imei1, for single-IMEI clients. Ignored if imei1 is also sent." }
 *               deviceModel: { type: string, example: "Galaxy S23" }
 *     responses:
 *       200: { description: IMEI verification completed }
 *       422: { description: Validation failed }
 */
router.post(
  '/verify',
  authenticate,
  requireBalance('IVS_CHECK'),
  imeiVerificationLimiter,
  normalizeImeiBody,
  verifyImeiValidator,
  validateRequest,
  ivsController.verifyImei
);

/**
 * @openapi
 * /ivs/history:
 *   get:
 *     tags: [IVS]
 *     summary: List the caller's stored IMEI verifications (view-only, no charge)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *       - in: query
 *         name: search
 *         description: Case-insensitive filter across reference id, customer name, device model, IMEI and CEIR status (and the charged amount for a numeric query).
 *         schema: { type: string, example: "Galaxy" }
 *     responses:
 *       200: { description: Verification history returned }
 */
router.get('/history', authenticate, ivsController.getHistory);

/**
 * @openapi
 * /ivs/aadhaar/send-otp:
 *   post:
 *     tags: [IVS]
 *     summary: Send an OTP to verify the CUSTOMER's Aadhaar (device seller) in the IMEI flow
 *     description: Independent of the logged-in user's own KYC — does not require or set aadhaarVerified. Returns a refId to pass to /ivs/aadhaar/verify-otp.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [aadhaarNumber]
 *             properties:
 *               aadhaarNumber: { type: string, example: "234567890123" }
 *     responses:
 *       200: { description: OTP sent; response data has refId }
 *       422: { description: Validation failed }
 */
router.post(
  '/aadhaar/send-otp',
  authenticate,
  loadPolicy,
  customerAadhaarSendOtpValidator,
  validateRequest,
  ivsController.sendCustomerAadhaarOtp
);

/**
 * @openapi
 * /ivs/aadhaar/verify-otp:
 *   post:
 *     tags: [IVS]
 *     summary: Verify the CUSTOMER's Aadhaar OTP in the IMEI flow
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refId, otp]
 *             properties:
 *               refId: { type: string }
 *               otp: { type: string, example: "123456" }
 *     responses:
 *       200: { description: Aadhaar verified }
 *       400: { description: Invalid OTP }
 *       422: { description: Validation failed }
 */
router.post(
  '/aadhaar/verify-otp',
  authenticate,
  loadPolicy,
  customerAadhaarVerifyOtpValidator,
  validateRequest,
  ivsController.verifyCustomerAadhaarOtp
);

module.exports = router;
