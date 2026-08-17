const express = require('express');
const adminController = require('../controllers/admin.controller');
const adminAuth = require('../middleware/adminAuth.middleware');
const validateRequest = require('../../middleware/validateRequest.middleware');
const { adminLoginLimiter } = require('../../middleware/rateLimiter.middleware');
const {
  loginValidator,
  updateSettingsValidator,
  userIdParamValidator,
} = require('../validators/admin.validator');

const router = express.Router();

/**
 * @openapi
 * /admin/login:
 *   post:
 *     tags: [Admin]
 *     summary: Sign in to the admin portal
 *     description: Email + password. Returns an admin JWT carrying typ=admin; user tokens are never accepted on /admin routes.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, example: "admin@grest.in" }
 *               password: { type: string, example: "••••••••" }
 *     responses:
 *       200: { description: Signed in }
 *       401: { description: Invalid email or password }
 */
router.post('/login', adminLoginLimiter, loginValidator, validateRequest, adminController.login);

/**
 * @openapi
 * /admin/me:
 *   get:
 *     tags: [Admin]
 *     summary: Current admin profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile fetched }
 */
router.get('/me', adminAuth, adminController.me);

/**
 * @openapi
 * /admin/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Dashboard counters
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Stats fetched }
 */
router.get('/stats', adminAuth, adminController.getStats);

/**
 * @openapi
 * /admin/settings:
 *   get:
 *     tags: [Admin]
 *     summary: Current runtime settings and their definitions
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Settings fetched }
 *   patch:
 *     tags: [Admin]
 *     summary: Update runtime settings
 *     description: Partial patch. Takes effect within seconds across the API without a restart. Turning aadhaarVerificationEnabled off makes Aadhaar optional on every endpoint.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               aadhaarVerificationEnabled: { type: boolean, example: false }
 *     responses:
 *       200: { description: Settings updated }
 *       422: { description: Unknown setting or wrong value type }
 */
router.get('/settings', adminAuth, adminController.getSettings);
router.patch(
  '/settings',
  adminAuth,
  updateSettingsValidator,
  validateRequest,
  adminController.updateSettings
);

/**
 * @openapi
 * /admin/transactions:
 *   get:
 *     tags: [Admin]
 *     summary: Wallet ledger across all users
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: type, schema: { type: string, enum: [CREDIT, DEBIT] } }
 *       - { in: query, name: reason, schema: { type: string, example: FEATURE_CHARGE } }
 *     responses:
 *       200: { description: Transactions fetched }
 */
router.get('/transactions', adminAuth, adminController.listTransactions);

/**
 * @openapi
 * /admin/imei-checks:
 *   get:
 *     tags: [Admin]
 *     summary: IMEI verification audit log across all users
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: status, schema: { type: string, enum: [CLEAN, BLOCKED, STOLEN, UNKNOWN, ERROR] } }
 *     responses:
 *       200: { description: IMEI checks fetched }
 */
router.get('/imei-checks', adminAuth, adminController.listImeiChecks);

/**
 * @openapi
 * /admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: User directory — searchable, filterable, newest first
 *     description: >-
 *       Each row carries the user's wallet balance alongside their profile, so the
 *       list is useful without opening each account. `search` matches any one of
 *       mobile, name, company name, email, PAN, GST or referral code
 *       (case-insensitive, partial).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *       - { in: query, name: search, schema: { type: string }, description: "Mobile, name, company, email, PAN, GST or referral code" }
 *       - { in: query, name: kycCompleted, schema: { type: boolean } }
 *       - { in: query, name: userType, schema: { type: string, enum: [vendor, individual] } }
 *       - { in: query, name: status, schema: { type: string, enum: [ACTIVE, BLOCKED] } }
 *     responses:
 *       200: { description: Users fetched successfully }
 *       401: { description: Admin authentication required }
 */
router.get('/users', adminAuth, adminController.listUsers);

/**
 * @openapi
 * /admin/users/{userId}:
 *   get:
 *     tags: [Admin]
 *     summary: Everything about one user — profile, KYC, wallet, referrals, activity totals and recent records
 *     description: >-
 *       The same payload the user sees at /user/me, plus a `recent` block holding
 *       their last 20 IMEI checks (with device model and IMEIs), last 20 wallet
 *       ledger movements and last 20 top-up orders. For the complete history use
 *       the paginated /admin/imei-checks and /admin/transactions endpoints.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: userId, required: true, schema: { type: string }, description: Mongo id of the user }
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
 *                     user: { type: object }
 *                     kyc: { type: object }
 *                     wallet: { type: object }
 *                     referral: { type: object }
 *                     activity: { type: object }
 *                     account: { type: object }
 *                     recent:
 *                       type: object
 *                       properties:
 *                         imeiChecks: { type: array, items: { type: object } }
 *                         transactions: { type: array, items: { type: object } }
 *                         payments: { type: array, items: { type: object } }
 *       401: { description: Admin authentication required }
 *       404: { description: User not found }
 *       422: { description: Malformed user id }
 */
router.get(
  '/users/:userId',
  adminAuth,
  userIdParamValidator,
  validateRequest,
  adminController.getUser
);

module.exports = router;
