const express = require('express');
const blanccoController = require('../controllers/blancco.controller');
const authenticate = require('../middleware/auth.middleware');
const requireFeatureAccess = require('../middleware/requireFeatureAccess.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { createSessionValidator } = require('../validators/blancco.validator');

const router = express.Router();

/**
 * @openapi
 * /blancco/scan/{sessionToken}:
 *   get:
 *     tags: [Blancco]
 *     summary: One-time QR scan endpoint (public, no auth)
 *     description: >
 *       The customer's phone hits this URL by scanning the QR code. On the
 *       first scan, the session is marked SCANNED and the customer is
 *       redirected (302) to the Blancco diagnosis app. Every subsequent scan
 *       returns 409 — the QR is single-use. Expired sessions return 410.
 *     parameters:
 *       - { in: path, name: sessionToken, required: true, schema: { type: string } }
 *     responses:
 *       302: { description: Redirected to Blancco diagnosis }
 *       404: { description: Session not found }
 *       409: { description: QR already used }
 *       410: { description: Session expired }
 */
router.get('/scan/:sessionToken', blanccoController.scanQr);

/**
 * @openapi
 * /blancco/sessions:
 *   post:
 *     tags: [Blancco]
 *     summary: Create a QR diagnosis session with customer details
 *     description: >
 *       Stores customer information and generates a one-time QR code that the
 *       customer scans to start diagnosis in the Blancco app. The QR expires
 *       after 24 hours and can only be scanned once. Aadhaar is validated in
 *       full but stored masked.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerName, customerPhone, price]
 *             properties:
 *               customerName:  { type: string, example: "Aniket Agrawal" }
 *               customerPhone: { type: string, example: "9003748031" }
 *               customerEmail: { type: string, example: "aniket@example.com" }
 *               aadhaarNumber: { type: string, example: "234567890123", description: "Stored masked." }
 *               imei:          { type: string, example: "356938035643809" }
 *               deviceModel:   { type: string, example: "iPhone 13 Pro" }
 *               deviceBrand:   { type: string, example: "Apple" }
 *               price:         { type: number, example: 499, description: "Rupees charged to the customer." }
 *     responses:
 *       201: { description: Session created with QR code }
 *       422: { description: Validation failed }
 */
router.post(
  '/sessions',
  authenticate,
  requireFeatureAccess('DIAGNOSE'),
  createSessionValidator,
  validateRequest,
  blanccoController.createSession
);

/**
 * @openapi
 * /blancco/sessions:
 *   get:
 *     tags: [Blancco]
 *     summary: List the caller's QR diagnosis sessions (newest first)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 50 } }
 *       - in: query
 *         name: search
 *         description: Case-insensitive filter across customer name, phone, email, IMEI, device model and brand.
 *         schema: { type: string }
 *     responses:
 *       200: { description: Sessions returned }
 */
router.get('/sessions', authenticate, blanccoController.getSessions);

/**
 * @openapi
 * /blancco/sessions/{id}:
 *   get:
 *     tags: [Blancco]
 *     summary: Get a single QR diagnosis session
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Session returned }
 *       404: { description: Session not found }
 */
router.get('/sessions/:id', authenticate, blanccoController.getSession);

/**
 * @openapi
 * /blancco/stats:
 *   get:
 *     tags: [Blancco]
 *     summary: Diagnosis stats for the logged-in vendor
 *     description: Returns total, pending, scanned, completed and expired counts.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Stats returned }
 */
router.get('/stats', authenticate, blanccoController.getStats);

/**
 * @openapi
 * /blancco/export:
 *   get:
 *     tags: [Blancco]
 *     summary: Export all diagnosis sessions for download
 *     description: Returns all sessions for the logged-in vendor as a JSON array. The frontend can convert this to CSV/PDF for download.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Data exported }
 */
router.get('/export', authenticate, blanccoController.exportSessions);

/**
 * @openapi
 * /blancco/sessions/{id}/report:
 *   get:
 *     tags: [Blancco]
 *     summary: Get diagnosis report for a session
 *     description: >
 *       Checks Blancco for whether the diagnosis is complete. If the QR has
 *       not been scanned yet, returns a message saying so. If scanned but
 *       diagnosis is still running, returns diagnoseCompleted=false. If
 *       complete, fetches the report live from Blancco (never stored locally)
 *       and returns it alongside stored customer details.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Report returned (or diagnosis still pending) }
 *       404: { description: Session not found }
 *       410: { description: Session expired }
 *       502: { description: Failed to fetch report from Blancco }
 */
router.get('/sessions/:id/report', authenticate, blanccoController.getReport);

module.exports = router;
