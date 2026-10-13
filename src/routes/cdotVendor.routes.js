const express = require('express');
const cdotVendorController = require('../controllers/cdotVendor.controller');
const vendorAuth = require('../middleware/vendorAuth.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const {
  vendorRegisterValidator,
  vendorLoginValidator,
  changePasswordValidator,
} = require('../validators/cdot.validator');

const router = express.Router();

/**
 * @openapi
 * /vendor/cdot/auth/register:
 *   post:
 *     tags: [CDOT Vendor]
 *     summary: Register as C-DOT vendor
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, companyName]
 *             properties:
 *               email: { type: string, example: "vendor@abc.com" }
 *               password: { type: string, example: "SecurePass123" }
 *               companyName: { type: string, example: "ABC Telecom" }
 *     responses:
 *       201: { description: Vendor registered successfully }
 *       409: { description: Email already registered }
 */
router.post(
  '/auth/register',
  vendorRegisterValidator,
  validateRequest,
  cdotVendorController.register
);

/**
 * @openapi
 * /vendor/cdot/auth/login:
 *   post:
 *     tags: [CDOT Vendor]
 *     summary: Login as C-DOT vendor
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, example: "vendor@abc.com" }
 *               password: { type: string, example: "SecurePass123" }
 *     responses:
 *       200: { description: Login successful }
 *       401: { description: Invalid credentials }
 */
router.post(
  '/auth/login',
  vendorLoginValidator,
  validateRequest,
  cdotVendorController.login
);

/**
 * @openapi
 * /vendor/cdot/auth/change-password:
 *   post:
 *     tags: [CDOT Vendor]
 *     summary: Change vendor password
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, minLength: 8 }
 *     responses:
 *       200: { description: Password changed successfully }
 */
router.post(
  '/auth/change-password',
  vendorAuth,
  changePasswordValidator,
  validateRequest,
  cdotVendorController.changePassword
);

/**
 * @openapi
 * /vendor/cdot/dashboard:
 *   get:
 *     tags: [CDOT Vendor]
 *     summary: Get vendor dashboard stats
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Dashboard data }
 */
router.get('/dashboard', vendorAuth, cdotVendorController.getDashboard);

/**
 * @openapi
 * /vendor/cdot/api-calls:
 *   get:
 *     tags: [CDOT Vendor]
 *     summary: Get API call history
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *     responses:
 *       200: { description: API calls fetched }
 */
router.get('/api-calls', vendorAuth, cdotVendorController.getApiCalls);

/**
 * @openapi
 * /vendor/cdot/transactions:
 *   get:
 *     tags: [CDOT Vendor]
 *     summary: Get wallet transaction history
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *     responses:
 *       200: { description: Transactions fetched }
 */
router.get('/transactions', vendorAuth, cdotVendorController.getTransactions);

/**
 * @openapi
 * /vendor/cdot/api-key:
 *   get:
 *     tags: [CDOT Vendor]
 *     summary: Get current API key
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: API key fetched }
 */
router.get('/api-key', vendorAuth, cdotVendorController.getApiKey);

/**
 * @openapi
 * /vendor/cdot/api-key/regenerate:
 *   post:
 *     tags: [CDOT Vendor]
 *     summary: Regenerate API key (old key becomes inactive)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: API key regenerated }
 */
router.post(
  '/api-key/regenerate',
  vendorAuth,
  cdotVendorController.regenerateApiKey
);

module.exports = router;
