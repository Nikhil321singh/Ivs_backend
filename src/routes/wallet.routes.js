const express = require('express');
const walletController = require('../controllers/wallet.controller');
const authenticate = require('../middleware/auth.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { topupOrderValidator, verifyPaymentValidator } = require('../validators/wallet.validator');

const router = express.Router();

// NOTE: POST /wallet/webhook/razorpay is intentionally NOT defined here. It
// needs the raw request body for signature verification and is registered in
// app.js before express.json().

/**
 * @openapi
 * /wallet:
 *   get:
 *     tags: [Wallet]
 *     summary: Get the current user's token wallet (balance + lifetime stats)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Wallet fetched successfully }
 *       401: { description: Unauthorized }
 */
router.get('/', authenticate, walletController.getWallet);

/**
 * @openapi
 * /wallet/transactions:
 *   get:
 *     tags: [Wallet]
 *     summary: Paginated wallet ledger (credits and debits)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200: { description: Transactions fetched successfully }
 *       401: { description: Unauthorized }
 */
router.get('/transactions', authenticate, walletController.getTransactions);

/**
 * @openapi
 * /wallet/topup/order:
 *   post:
 *     tags: [Wallet]
 *     summary: Create a Razorpay order to buy tokens (1 token = ₹1)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: integer, example: 100, description: "Amount in ₹" }
 *     responses:
 *       201: { description: Order created; open Razorpay Checkout with the returned orderId }
 *       422: { description: Validation failed }
 */
router.post('/topup/order', authenticate, topupOrderValidator, validateRequest, walletController.createTopupOrder);

/**
 * @openapi
 * /wallet/topup/verify:
 *   post:
 *     tags: [Wallet]
 *     summary: Verify a completed Razorpay payment and credit tokens (fast-path)
 *     description: Optional client-side confirmation. The webhook remains the source of truth; both are idempotent so tokens are credited exactly once.
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
 *       200: { description: Payment verified and tokens credited }
 *       400: { description: Invalid signature }
 *       404: { description: Order not found }
 */
router.post('/topup/verify', authenticate, verifyPaymentValidator, validateRequest, walletController.verifyPayment);

module.exports = router;
