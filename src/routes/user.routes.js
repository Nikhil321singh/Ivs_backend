const express = require('express');
const userController = require('../controllers/user.controller');
const authenticate = require('../middleware/auth.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { uploadProfileImage } = require('../middleware/upload.middleware');
const loadAadhaarPolicy = require('../middleware/aadhaarPolicy.middleware');
const {
  completeKycValidator,
  updateProfileValidator,
  sendAadhaarOtpValidator,
  verifyAadhaarOtpValidator,
} = require('../validators/user.validator');

const router = express.Router();

/**
 * @openapi
 * /user/aadhaar/send-otp:
 *   post:
 *     tags: [KYC]
 *     summary: Start Aadhaar e-KYC authentication by requesting an OTP via UIDAI
 *     description: Aadhaar is verified via an OTP action, not a manual text field. Call this first, then verify-otp, before submitting /user/complete-kyc.
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
 *       200: { description: OTP sent successfully }
 *       409: { description: Aadhaar already verified or already linked to another account }
 *       422: { description: Validation failed }
 */
router.post(
  '/aadhaar/send-otp',
  authenticate,
  sendAadhaarOtpValidator,
  validateRequest,
  userController.sendAadhaarOtp
);

/**
 * @openapi
 * /user/aadhaar/verify-otp:
 *   post:
 *     tags: [KYC]
 *     summary: Verify the Aadhaar OTP and complete UIDAI e-KYC authentication
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [otp]
 *             properties:
 *               otp: { type: string, example: "123456" }
 *     responses:
 *       200: { description: Aadhaar verified successfully }
 *       400: { description: Missing/expired session or invalid OTP }
 *       409: { description: Aadhaar already linked to another account }
 *       422: { description: Validation failed }
 */
router.post(
  '/aadhaar/verify-otp',
  authenticate,
  verifyAadhaarOtpValidator,
  validateRequest,
  userController.verifyAadhaarOtp
);

/**
 * @openapi
 * /user/complete-kyc:
 *   post:
 *     tags: [KYC]
 *     summary: Submit KYC. Two shapes keyed off userType — vendor (GST-based) or individual (Aadhaar-based). Email and PAN are required for both.
 *     description: >-
 *       For userType=vendor, submit companyName, email, panNumber, gstNumber and an owner image (profileImage) — no Aadhaar.
 *       For userType=individual, submit name, email, panNumber and aadhaarNumber (which must already be verified via /user/aadhaar/verify-otp) — no GST, no image.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [userType, phone, email, panNumber]
 *             properties:
 *               userType: { type: string, enum: [vendor, individual] }
 *               phone: { type: string, example: "9876543210", description: "10-digit contact number" }
 *               email: { type: string }
 *               panNumber: { type: string, example: "ABCDE1234F" }
 *               companyName: { type: string, description: "Business name — required for userType=vendor" }
 *               gstNumber: { type: string, example: "22AAAAA0000A1Z5", description: "Required for userType=vendor" }
 *               profileImage: { type: string, format: binary, description: "Owner image — required for userType=vendor" }
 *               name: { type: string, description: "Required for userType=individual" }
 *               aadhaarNumber: { type: string, example: "234567890123", description: "Required for userType=individual; must match the Aadhaar already verified via /user/aadhaar/verify-otp" }
 *     responses:
 *       200: { description: KYC completed successfully }
 *       400: { description: (individual) Aadhaar not yet verified, or aadhaarNumber does not match the verified Aadhaar }
 *       409: { description: KYC already completed or PAN/GST/email already in use }
 *       422: { description: Validation failed }
 */
router.post(
  '/complete-kyc',
  authenticate,
  uploadProfileImage,
  loadAadhaarPolicy,
  completeKycValidator,
  validateRequest,
  userController.completeKyc
);

/**
 * @openapi
 * /user/update-profile:
 *   put:
 *     tags: [User]
 *     summary: Update the current user's name, company name, email and/or profile photo
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               companyName: { type: string }
 *               email: { type: string }
 *               profileImage: { type: string, format: binary }
 *     responses:
 *       200: { description: Profile updated successfully }
 *       409: { description: Email already in use }
 *       422: { description: Validation failed }
 */
router.put(
  '/update-profile',
  authenticate,
  uploadProfileImage,
  updateProfileValidator,
  validateRequest,
  userController.updateProfile
);

/**
 * @openapi
 * /user/profile:
 *   get:
 *     tags: [User]
 *     summary: Get the currently authenticated user's profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile fetched successfully }
 *       401: { description: Unauthorized }
 */
router.get('/profile', authenticate, userController.getProfile);

module.exports = router;
