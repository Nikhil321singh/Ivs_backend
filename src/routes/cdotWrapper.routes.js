const express = require('express');
const cdotWrapperController = require('../controllers/cdotWrapper.controller');
const validateRequest = require('../middleware/validateRequest.middleware');
const { checkImeiValidator } = require('../validators/cdot.validator');

const router = express.Router();

/**
 * @openapi
 * /wrapper/cdot/check-imei:
 *   post:
 *     tags: [CDOT Wrapper]
 *     summary: Check IMEI status via C-DOT (pay-per-use)
 *     description: >-
 *       Vendor endpoint to check IMEI status. Each check costs ₹19.
 *       Requires valid API key in X-API-Key header.
 *       Deducts from vendor wallet automatically.
 *     parameters:
 *       - { in: header, name: X-API-Key, required: true, schema: { type: string }, description: "Vendor API key" }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [imei]
 *             properties:
 *               imei: { type: string, example: "353170101039885", description: "15-digit IMEI" }
 *     responses:
 *       200:
 *         description: IMEI checked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 imeiStatus: { type: string, enum: [CLEAN, BLOCKED, STOLEN] }
 *                 deviceStatus: { type: string }
 *                 blockingReason: { type: string, nullable: true }
 *                 costDeducted: { type: number, example: 1900, description: "Cost in paise (₹19)" }
 *                 walletBalance: { type: number, description: "Remaining wallet balance in paise" }
 *                 checksRemaining: { type: number, description: "Number of checks remaining" }
 *       401:
 *         description: Invalid or missing API key
 *       402:
 *         description: Insufficient wallet balance
 *       422:
 *         description: Invalid IMEI format
 */
router.post(
  '/check-imei',
  checkImeiValidator,
  validateRequest,
  cdotWrapperController.checkImei
);

module.exports = router;
