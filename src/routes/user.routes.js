const express = require('express');
const userController = require('../controllers/user.controller');
const authenticate = require('../middleware/auth.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { uploadProfileImage, uploadKycImages } = require('../middleware/upload.middleware');
const loadPolicy = require('../middleware/policy.middleware');
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
  loadPolicy,
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
  loadPolicy,
  verifyAadhaarOtpValidator,
  validateRequest,
  userController.verifyAadhaarOtp
);

/**
 * @openapi
 * /user/complete-kyc:
 *   post:
 *     tags: [KYC]
 *     summary: Submit KYC. Required fields depend on userType.
 *     description: >-
 *       For userType=individual (the default when userType is omitted): name, email and panNumber.
 *       For userType=vendor: companyName and email. Email is the only field both must supply — a
 *       vendor is identified by its business, so it is not asked for a personal name or PAN.
 *       Neither type is forced through the Aadhaar OTP step, and a vendor is not forced to supply
 *       GST or an owner image. Every other field is accepted when the client collects it and is
 *       format-checked when supplied.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               name: { type: string, example: "Asha Rao", description: "Required for userType=individual" }
 *               email: { type: string }
 *               panNumber: { type: string, example: "ABCDE1234F", description: "Required for userType=individual" }
 *               userType: { type: string, enum: [vendor, individual], description: "Defaults to individual. Selects which fields are required." }
 *               phone: { type: string, example: "9876543210", description: "Optional 10-digit contact number" }
 *               companyName: { type: string, description: "Required for userType=vendor" }
 *               gstNumber: { type: string, example: "22AAAAA0000A1Z5", description: "Optional; validated and stored when supplied" }
 *               profileImage: { type: string, format: binary, description: "Optional owner image" }
 *               aadhaarNumber: { type: string, example: "234567890123", description: "Optional. If the account already verified an Aadhaar via /user/aadhaar/verify-otp, a supplied number must match it." }
 *     responses:
 *       200: { description: KYC completed successfully; joining bonus credited }
 *       400: { description: aadhaarNumber does not match the Aadhaar already verified for this account }
 *       409: { description: KYC already completed or PAN/GST/email already in use }
 *       422: { description: Validation failed }
 */
router.post(
  '/complete-kyc',
  authenticate,
  uploadKycImages,
  loadPolicy,
  completeKycValidator,
  validateRequest,
  userController.completeKyc
);

/**
 * @openapi
 * /user/skip-kyc:
 *   post:
 *     tags: [User]
 *     summary: Finish onboarding without submitting KYC
 *     description: Only available while the admin "KYC required" setting is off — otherwise returns 403. Marks the account complete without storing any identity data. Check GET /settings to know whether to offer this.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: KYC skipped }
 *       403: { description: KYC is required and cannot be skipped }
 *       409: { description: KYC already completed }
 */
router.post('/skip-kyc', authenticate, userController.skipKyc);

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

/**
 * @openapi
 * /user/account:
 *   delete:
 *     tags: [User]
 *     summary: Permanently delete the signed-in user's account
 *     description: >-
 *       Irreversible. Scrubs every personal field, deletes the stored profile image,
 *       revokes all sessions on every device, and releases the mobile number so the
 *       person can sign up again as a new account. Wallet, payment and IMEI verification
 *       records are retained for tax and audit but no longer identify the user, and any
 *       remaining token balance is forfeited. See /account-deletion for the user-facing
 *       description of exactly what is kept.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Account deleted }
 *       401: { description: Unauthorized }
 *       409: { description: Account already deleted }
 */
router.delete('/account', authenticate, userController.deleteAccount);

/**
 * @openapi
 * /user/me:
 *   get:
 *     tags: [User]
 *     summary: Everything about the signed-in user in one call — profile, KYC state, wallet, referrals, activity totals and account info
 *     description: >-
 *       One round trip for the home screen. Replaces having to call /user/profile,
 *       /wallet/balance, /referral/summary and the history endpoints separately.
 *       Read-only — nothing is created or modified, including the wallet, so a user
 *       who has never transacted reports a zeroed wallet rather than having one
 *       provisioned. Aggregate totals only; use the paginated endpoints
 *       (/wallet/statement, /ivs/history) for individual rows.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: User details fetched successfully
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
 *                     user: { type: object, description: The full user profile, same shape as /user/profile }
 *                     kyc:
 *                       type: object
 *                       properties:
 *                         completed: { type: boolean }
 *                         userType: { type: string, nullable: true, enum: [vendor, individual] }
 *                         aadhaarVerified: { type: boolean }
 *                         aadhaarNumber: { type: string, nullable: true, description: Masked value only }
 *                         panNumber: { type: string, nullable: true }
 *                         gstNumber: { type: string, nullable: true }
 *                         isGstRegistered: { type: boolean }
 *                         kycRequired: { type: boolean }
 *                         aadhaarVerificationEnabled: { type: boolean }
 *                         canSkipKyc: { type: boolean }
 *                     wallet:
 *                       type: object
 *                       properties:
 *                         balance: { type: integer }
 *                         totalPurchased: { type: integer }
 *                         totalBonus: { type: integer }
 *                         totalSpent: { type: integer }
 *                     referral:
 *                       type: object
 *                       properties:
 *                         referralCode: { type: string, nullable: true }
 *                         totalReferred: { type: integer }
 *                         totalRewarded: { type: integer }
 *                         rewardPerReferral: { type: integer }
 *                         welcomeBonus: { type: integer }
 *                         referredBy: { type: object, nullable: true }
 *                     activity:
 *                       type: object
 *                       properties:
 *                         imeiChecks: { type: object, description: total/allowed/blocked/tokensSpent/lastAt }
 *                         diagnose: { type: object, description: total/lastAt }
 *                         payments: { type: object, description: totalPaid/amountPaise/amountInr/tokensPurchased/lastAt }
 *                     account:
 *                       type: object
 *                       properties:
 *                         status: { type: string }
 *                         isMobileVerified: { type: boolean }
 *                         activeSessions: { type: integer, description: Devices with a live refresh token }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *                         deletedAt: { type: string, format: date-time, nullable: true }
 *       401: { description: Unauthorized }
 */
router.get('/me', authenticate, userController.getUserDetails);

/**
 * @openapi
 * /user/aadhaar/digilocker/start:
 *   post:
 *     tags: [KYC]
 *     summary: Start Aadhaar verification through DigiLocker
 *     description: >-
 *       Creates a DigiLocker session and returns the URL the client must open in a browser.
 *       The user authenticates with their own mobile number, OTP and consent inside DigiLocker —
 *       this API never sees or asks for that OTP. Poll
 *       /user/aadhaar/digilocker/{verificationId} for the outcome once the browser returns.
 *       Any earlier unfinished session for the same user is expired first.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Session created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     verificationId: { type: string }
 *                     authorizationUrl: { type: string }
 *       409: { description: Aadhaar already verified for this account }
 *       502: { description: DigiLocker could not start the session }
 */
router.post('/aadhaar/digilocker/start', authenticate, userController.startDigilockerAadhaar);

/**
 * @openapi
 * /user/aadhaar/digilocker/callback:
 *   get:
 *     tags: [KYC]
 *     summary: DigiLocker redirects the user's browser here after consent
 *     description: >-
 *       Not called by the app. Unauthenticated by necessity — the request comes from
 *       DigiLocker and carries no bearer token, so the unguessable single-use refid is the
 *       only credential. Runs the rest of the flow (access token, issued files, Aadhaar
 *       lookup, XML download and parse), records the outcome, then redirects to the app
 *       carrying only the verification id. Never returns Aadhaar details in the URL.
 *     parameters:
 *       - { in: query, name: refid, required: true, schema: { type: string } }
 *     responses:
 *       302: { description: Redirect back to the app }
 *       400: { description: refid missing }
 *       404: { description: No such session }
 */
router.get('/aadhaar/digilocker/callback', userController.digilockerAadhaarCallback);
// refid in the path: the provider strips/duplicates the query on the redirect
// back, so this is the reliable form (see startVerification). Same handler.
router.get('/aadhaar/digilocker/callback/:refid', userController.digilockerAadhaarCallback);

/**
 * @openapi
 * /user/aadhaar/digilocker/{verificationId}:
 *   get:
 *     tags: [KYC]
 *     summary: Status of one DigiLocker Aadhaar verification
 *     description: >-
 *       Scoped to the caller. A verification belonging to another account is indistinguishable
 *       from one that does not exist. Statuses are application-level, never provider-specific —
 *       terminal ones are VERIFIED, FAILED, AADHAAR_NOT_FOUND and EXPIRED.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: verificationId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Verification status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     status: { type: string, example: VERIFIED }
 *                     verified: { type: boolean }
 *                     name: { type: string, nullable: true }
 *                     maskedAadhaar: { type: string, nullable: true, example: "XXXX-XXXX-1234" }
 *                     failureCode: { type: string, nullable: true }
 *       404: { description: Not found for this user }
 */
router.get(
  '/aadhaar/digilocker/:verificationId',
  authenticate,
  userController.getDigilockerAadhaarVerification
);


module.exports = router;
