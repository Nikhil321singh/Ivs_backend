const express = require('express');
const cdotAdminController = require('../../controllers/cdotAdmin.controller');
const adminAuth = require('../middleware/adminAuth.middleware');
const validateRequest = require('../../middleware/validateRequest.middleware');
const {
  createVendorValidator,
  vendorIdParamValidator,
  adjustWalletValidator,
} = require('../validators/cdot.validator');

const router = express.Router();

/**
 * @openapi
 * /admin/cdot/vendors:
 *   post:
 *     tags: [Admin CDOT]
 *     summary: Create new C-DOT vendor
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, companyName]
 *             properties:
 *               email: { type: string, example: "vendor@abc.com" }
 *               companyName: { type: string, example: "ABC Telecom" }
 *               initialWalletBalance: { type: number, example: 100000, description: "Initial balance in paise (optional)" }
 *     responses:
 *       201: { description: Vendor created successfully }
 *   get:
 *     tags: [Admin CDOT]
 *     summary: List all C-DOT vendors
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: search, schema: { type: string }, description: "Search by email or company name" }
 *       - { in: query, name: isActive, schema: { type: boolean }, description: "Filter by active/inactive" }
 *     responses:
 *       200: { description: Vendors listed successfully }
 */
router.post(
  '/vendors',
  adminAuth,
  createVendorValidator,
  validateRequest,
  cdotAdminController.createVendor
);

router.get('/vendors', adminAuth, cdotAdminController.listVendors);

/**
 * @openapi
 * /admin/cdot/vendors/{vendorId}:
 *   get:
 *     tags: [Admin CDOT]
 *     summary: Get vendor details
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: vendorId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Vendor details fetched }
 */
router.get(
  '/vendors/:vendorId',
  adminAuth,
  vendorIdParamValidator,
  validateRequest,
  cdotAdminController.getVendorDetail
);

/**
 * @openapi
 * /admin/cdot/vendors/{vendorId}/wallet:
 *   patch:
 *     tags: [Admin CDOT]
 *     summary: Adjust vendor wallet balance
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: vendorId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, reason]
 *             properties:
 *               amount: { type: number, example: 50000, description: "Positive to credit, negative to debit (in paise)" }
 *               reason: { type: string, example: "Promotional credit" }
 *     responses:
 *       200: { description: Wallet adjusted successfully }
 */
router.patch(
  '/vendors/:vendorId/wallet',
  adminAuth,
  adjustWalletValidator,
  validateRequest,
  cdotAdminController.adjustWallet
);

/**
 * @openapi
 * /admin/cdot/vendors/{vendorId}/suspend:
 *   post:
 *     tags: [Admin CDOT]
 *     summary: Suspend vendor (disable API key)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: vendorId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Vendor suspended }
 */
router.post(
  '/vendors/:vendorId/suspend',
  adminAuth,
  vendorIdParamValidator,
  validateRequest,
  cdotAdminController.suspendVendor
);

/**
 * @openapi
 * /admin/cdot/vendors/{vendorId}/unsuspend:
 *   post:
 *     tags: [Admin CDOT]
 *     summary: Reactivate vendor
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: vendorId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Vendor reactivated }
 */
router.post(
  '/vendors/:vendorId/unsuspend',
  adminAuth,
  vendorIdParamValidator,
  validateRequest,
  cdotAdminController.unsuspendVendor
);

/**
 * @openapi
 * /admin/cdot/analytics:
 *   get:
 *     tags: [Admin CDOT]
 *     summary: Get C-DOT analytics and metrics
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Analytics fetched successfully }
 */
router.get('/analytics', adminAuth, cdotAdminController.getAnalytics);

/**
 * @openapi
 * /admin/cdot/vendors/{vendorId}/export:
 *   get:
 *     tags: [Admin CDOT]
 *     summary: Export vendor data
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: vendorId, required: true, schema: { type: string } }
 *       - { in: query, name: format, schema: { type: string, enum: [json, csv], default: json } }
 *     responses:
 *       200: { description: Data exported successfully }
 */
router.get(
  '/vendors/:vendorId/export',
  adminAuth,
  vendorIdParamValidator,
  validateRequest,
  cdotAdminController.exportVendorData
);

module.exports = router;
