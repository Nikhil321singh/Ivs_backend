const express = require('express');
const blanccoAdminController = require('../../controllers/blanccoAdmin.controller');
const adminAuth = require('../middleware/adminAuth.middleware');
const validateRequest = require('../../middleware/validateRequest.middleware');
const { param } = require('express-validator');

const router = express.Router();

const sessionIdParam = [
  param('sessionId').isMongoId().withMessage('A valid session ID is required.'),
];

/**
 * @openapi
 * /admin/blancco/sessions:
 *   get:
 *     tags: [Admin Blancco]
 *     summary: List all Blancco QR diagnosis sessions across vendors
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *       - { in: query, name: search, schema: { type: string }, description: "Search by customer name, phone, email, IMEI, device or session token" }
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, SCANNED, COMPLETED, EXPIRED] } }
 *       - { in: query, name: userId, schema: { type: string }, description: "Filter by vendor user ID" }
 *     responses:
 *       200: { description: Sessions listed }
 */
router.get('/sessions', adminAuth, blanccoAdminController.listSessions);

/**
 * @openapi
 * /admin/blancco/sessions/{sessionId}:
 *   get:
 *     tags: [Admin Blancco]
 *     summary: Get full details of a Blancco session including vendor info
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: sessionId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Session detail fetched }
 *       404: { description: Session not found }
 */
router.get(
  '/sessions/:sessionId',
  adminAuth,
  sessionIdParam,
  validateRequest,
  blanccoAdminController.getSessionDetail
);

/**
 * @openapi
 * /admin/blancco/stats:
 *   get:
 *     tags: [Admin Blancco]
 *     summary: Blancco diagnosis stats overview
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Stats fetched }
 */
router.get('/stats', adminAuth, blanccoAdminController.getStats);

module.exports = router;
