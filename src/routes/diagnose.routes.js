const express = require('express');
const diagnoseController = require('../controllers/diagnose.controller');
const authenticate = require('../middleware/auth.middleware');
const requireBalance = require('../middleware/requireBalance.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const {
  diagnoseValidator,
  diagnoseRecordValidator,
} = require('../validators/diagnose.validator');

const router = express.Router();

/**
 * @openapi
 * /diagnose:
 *   post:
 *     tags: [Diagnose]
 *     summary: Run a device diagnosis (costs 50 tokens on success)
 *     description: Requires sufficient token balance (returns 402 otherwise). Tokens are charged only when the third-party returns a successful diagnosis — errors are free to retry.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               imei: { type: string, example: "123456789012345" }
 *               deviceModel: { type: string, example: "Galaxy S23" }
 *     responses:
 *       200: { description: Diagnosis completed }
 *       402: { description: Insufficient token balance }
 *       422: { description: Validation failed }
 */
router.post(
  '/',
  authenticate,
  requireBalance('DIAGNOSE'),
  diagnoseValidator,
  validateRequest,
  diagnoseController.diagnose
);

/**
 * @openapi
 * /diagnose/history:
 *   get:
 *     tags: [Diagnose]
 *     summary: The caller's past device diagnoses (newest first)
 *     description: View-only, paginated history for the Records screen.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 50 } }
 *     responses:
 *       200: { description: Diagnosis history returned }
 */
router.get('/history', authenticate, diagnoseController.getHistory);

/**
 * @openapi
 * /diagnose/records:
 *   post:
 *     tags: [Diagnose]
 *     summary: Store a completed diagnosis against the customer it was done for (free)
 *     description: >
 *       Record-keeping only — this does not run a diagnosis and costs no tokens
 *       (that is POST /diagnose). `price` is the amount in RUPEES the vendor
 *       charged their customer, unrelated to the token wallet. `aadhaarNumber`
 *       is validated in full but stored MASKED ("XXXXXXXX1234"); the full number
 *       is never persisted.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerName, customerPhone, report, price]
 *             properties:
 *               customerName:  { type: string, example: "Aniket Agrawal" }
 *               customerPhone: { type: string, example: "9003748031" }
 *               customerEmail: { type: string, example: "aniketagr501@gmail.com" }
 *               aadhaarNumber: { type: string, example: "234567890123", description: "Stored masked, never in full." }
 *               imei:          { type: string, example: "356938035643809", description: "Exactly 15 digits. Optional — some devices have none." }
 *               deviceModel:   { type: string, example: "iPhone 13 Pro", description: "Free text, max 200 chars." }
 *               report:
 *                 description: Free text, or the structured output of a diagnosis tool.
 *                 oneOf:
 *                   - { type: string }
 *                   - { type: object }
 *               price:         { type: number, example: 499, description: "Rupees charged to the customer." }
 *               diagnosedAt:   { type: string, format: date-time, description: "When the diagnosis was performed. Defaults to now." }
 *     responses:
 *       201: { description: Diagnosis record saved }
 *       422: { description: Validation failed }
 */
router.post(
  '/records',
  authenticate,
  diagnoseRecordValidator,
  validateRequest,
  diagnoseController.createRecord
);

/**
 * @openapi
 * /diagnose/records:
 *   get:
 *     tags: [Diagnose]
 *     summary: The caller's stored diagnosis records (newest diagnosis first)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 50 } }
 *       - in: query
 *         name: search
 *         description: Case-insensitive filter across customer name, phone, email, IMEI and device model (and the price for a numeric query).
 *         schema: { type: string, example: "Aniket" }
 *     responses:
 *       200: { description: Diagnosis records returned }
 */
router.get('/records', authenticate, diagnoseController.getRecords);

/**
 * @openapi
 * /diagnose/records/{id}:
 *   get:
 *     tags: [Diagnose]
 *     summary: One stored diagnosis record, including its full report
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Diagnosis record returned }
 *       404: { description: No such record for this account }
 */
router.get('/records/:id', authenticate, diagnoseController.getRecordById);

module.exports = router;
