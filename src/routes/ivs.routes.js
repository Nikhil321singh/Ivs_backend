const express = require('express');
const ivsController = require('../controllers/ivs.controller');
const authenticate = require('../middleware/auth.middleware');
const requireBalance = require('../middleware/requireBalance.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { imeiVerificationLimiter } = require('../middleware/rateLimiter.middleware');
const { uploadCsv } = require('../middleware/upload.middleware');
const { verifyImeiValidator, historyQueryValidator } = require('../validators/ivs.validator');

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
 *             required: [imei1, customerName, customerMobile, aadhaarNumber]
 *             properties:
 *               imei1: { type: string, example: "123456789012345" }
 *               imei2: { type: string, example: "123456789012346" }
 *               deviceModel: { type: string, example: "Galaxy S23", description: "Device name/model" }
 *               customerName: { type: string, example: "Ravi Kumar", description: "Name of the customer whose device is being verified" }
 *               customerMobile: { type: string, example: "9876543210", description: "Customer's 10-digit mobile number" }
 *               aadhaarNumber: { type: string, example: "234567890123", description: "Customer's 12-digit Aadhaar (stored masked + hashed, never in full)" }
 *     responses:
 *       200: { description: IMEI verification completed }
 *       422: { description: Validation failed }
 */
router.post(
  '/verify',
  authenticate,
  requireBalance('IVS_CHECK'),
  imeiVerificationLimiter,
  verifyImeiValidator,
  validateRequest,
  ivsController.verifyImei
);

/**
 * @openapi
 * /ivs/verify/bulk:
 *   post:
 *     tags: [IVS]
 *     summary: Bulk-verify up to 10 devices from a CSV (20 tokens per definitive check)
 *     description: >-
 *       Upload a CSV with headers `imei1,imei2,deviceModel,customerName,customerMobile,aadhaarNumber`
 *       (imei2 and deviceModel optional), max 10 data rows. Requires enough balance to cover every
 *       row up front (rows × 20); only rows that return a definitive CEIR result are actually charged.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary, description: "CSV file (field name 'file')" }
 *     responses:
 *       200: { description: Bulk verification completed (per-row results + summary) }
 *       400: { description: Missing or unparseable CSV }
 *       402: { description: Insufficient token balance for the batch }
 *       422: { description: Empty CSV, more than 10 rows, or per-row validation errors }
 */
router.post(
  '/verify/bulk',
  authenticate,
  imeiVerificationLimiter,
  uploadCsv,
  ivsController.verifyBulkImei
);

/**
 * @openapi
 * /ivs/history:
 *   get:
 *     tags: [IVS]
 *     summary: Paginated IMEI verification history for the current user
 *     description: Newest first. Optional filters narrow the results; aadhaarNumber is hashed server-side to match (the full number is never stored).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *       - { in: query, name: imei, schema: { type: string }, description: "Match imei1 or imei2 (15 digits)" }
 *       - { in: query, name: customerMobile, schema: { type: string } }
 *       - { in: query, name: aadhaarNumber, schema: { type: string }, description: "12 digits; hashed to look up" }
 *       - { in: query, name: status, schema: { type: string, enum: [CLEAN, BLOCKED, STOLEN, UNKNOWN, ERROR] } }
 *       - { in: query, name: from, schema: { type: string, format: date-time } }
 *       - { in: query, name: to, schema: { type: string, format: date-time } }
 *     responses:
 *       200: { description: History fetched successfully }
 *       422: { description: Invalid query parameter }
 */
router.get(
  '/history',
  authenticate,
  historyQueryValidator,
  validateRequest,
  ivsController.getHistory
);

module.exports = router;
