const express = require('express');
const subscriptionController = require('../controllers/subscription.controller');
const authenticate = require('../middleware/auth.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { createOrderValidator } = require('../validators/subscription.validator');
const { verifyPaymentValidator } = require('../validators/wallet.validator');

const router = express.Router();

// NOTE: there is no subscription-specific callback or webhook. Both are shared
// with the wallet (/wallet/topup/callback, /wallet/webhook/razorpay) and
// dispatch on the order's `purpose`, so the redirect-mode WebView flow and the
// exactly-once fulfilment guarantee are the same code for both product lines.

/**
 * @openapi
 * /subscription/order:
 *   post:
 *     tags: [Subscription]
 *     summary: Create a Razorpay order for a credit pack
 *     description: >
 *       Send either `planCode` for a catalogue pack, or `quantities` for a
 *       custom one — not both. The price is computed and frozen server-side
 *       onto the order; a price supplied by the client is ignored. Credits are
 *       granted only after Razorpay confirms payment.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               planCode: { type: string, example: "PRO_MAX" }
 *               quantities:
 *                 type: object
 *                 example: { IVS_CHECK: 120, DIAGNOSE: 60 }
 *     responses:
 *       201: { description: Order created; open Razorpay Checkout with the returned orderId }
 *       400: { description: Below the minimum quantity, or plan inactive }
 *       404: { description: Plan not found }
 *       422: { description: Validation failed }
 */
router.post(
  '/order',
  authenticate,
  createOrderValidator,
  validateRequest,
  subscriptionController.createOrder
);

/**
 * @openapi
 * /subscription/verify:
 *   post:
 *     tags: [Subscription]
 *     summary: Verify a completed Razorpay payment and grant credits (fast-path)
 *     description: Optional client-side confirmation. The webhook remains the source of truth; both are idempotent so credits are granted exactly once.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, paymentId, signature]
 *             properties:
 *               orderId: { type: string, example: "order_XXXXXXXX" }
 *               paymentId: { type: string, example: "pay_XXXXXXXX" }
 *               signature: { type: string }
 *     responses:
 *       200: { description: Payment verified and credits added }
 *       400: { description: Invalid signature }
 *       404: { description: Order not found }
 */
router.post(
  '/verify',
  authenticate,
  verifyPaymentValidator,
  validateRequest,
  subscriptionController.verifyPayment
);

/**
 * @openapi
 * /subscription/purchases:
 *   get:
 *     tags: [Subscription]
 *     summary: The caller's credit pack purchases, newest first
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200: { description: Purchases fetched successfully }
 *       401: { description: Unauthorized }
 */
router.get('/purchases', authenticate, subscriptionController.listPurchases);

module.exports = router;
