const express = require('express');
const planController = require('../controllers/plan.controller');
const authenticate = require('../middleware/auth.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { quantitiesValidator } = require('../validators/subscription.validator');

const router = express.Router();

/**
 * @openapi
 * /plans:
 *   get:
 *     tags: [Plans]
 *     summary: Credit packs available to the caller, plus the custom tier
 *     description: >
 *       Returns every active plan whose audience matches the caller's userType,
 *       already decorated with price, strikethrough MRP, discount percent and
 *       the effective per-check rate — all computed server-side so pricing can
 *       be retuned from the admin portal without an app release. The `custom`
 *       object describes the fourth tier: its minimum quantities, its discount,
 *       and a worked starting price.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Plans fetched successfully }
 *       401: { description: Unauthorized }
 */
router.get('/', authenticate, planController.listPlans);

/**
 * @openapi
 * /plans/custom/quote:
 *   post:
 *     tags: [Plans]
 *     summary: Price a custom quantity without creating an order
 *     description: >
 *       Self-serve custom pricing. The caller sends quantities and never a
 *       price — the server is the only thing that decides what a custom pack
 *       costs. Quantities below the admin-set minimums are refused with 400 and
 *       the minimums in the error body.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantities]
 *             properties:
 *               quantities:
 *                 type: object
 *                 example: { IVS_CHECK: 120, DIAGNOSE: 60 }
 *     responses:
 *       200: { description: Custom plan priced successfully }
 *       400: { description: Below the minimum quantity }
 *       422: { description: Validation failed }
 */
router.post(
  '/custom/quote',
  authenticate,
  quantitiesValidator,
  validateRequest,
  planController.quoteCustom
);

module.exports = router;
