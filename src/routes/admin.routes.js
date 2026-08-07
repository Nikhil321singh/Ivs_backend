const express = require('express');
const adminController = require('../controllers/admin.controller');
const adminAuth = require('../middleware/adminAuth.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { adminLoginLimiter } = require('../middleware/rateLimiter.middleware');
const { loginValidator, updateSettingsValidator } = require('../validators/admin.validator');

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

module.exports = router;
