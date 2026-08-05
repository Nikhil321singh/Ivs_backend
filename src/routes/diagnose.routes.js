const express = require('express');
const diagnoseController = require('../controllers/diagnose.controller');
const authenticate = require('../middleware/auth.middleware');
const requireBalance = require('../middleware/requireBalance.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { diagnoseValidator } = require('../validators/diagnose.validator');

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

module.exports = router;
