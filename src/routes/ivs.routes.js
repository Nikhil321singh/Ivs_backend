const express = require('express');
const ivsController = require('../controllers/ivs.controller');
const authenticate = require('../middleware/auth.middleware');
const requireBalance = require('../middleware/requireBalance.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { imeiVerificationLimiter } = require('../middleware/rateLimiter.middleware');
const { verifyImeiValidator } = require('../validators/ivs.validator');

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
 *             required: [imei1]
 *             properties:
 *               imei1: { type: string, example: "123456789012345" }
 *               imei2: { type: string, example: "123456789012346" }
 *               deviceModel: { type: string, example: "Galaxy S23" }
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

module.exports = router;
