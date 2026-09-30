const express = require('express');
const auctionController = require('../controllers/auction.controller');
const authenticate = require('../middleware/auth.middleware');

const router = express.Router();

/**
 * Device orders — what a buyer won or bought instantly, and where it is in
 * getting to them.
 *
 * Mounted at the top level rather than under /auctions because an order belongs
 * to the BUYER: "my orders" and "my listings" are different questions with
 * different owners, and the order outlives the auction that created it.
 *
 * Buyers only ever see their own. Fulfilment is moved by an admin — see
 * /admin/orders.
 */

/**
 * @openapi
 * /orders:
 *   get:
 *     tags: [Orders]
 *     summary: The caller's device orders, newest first
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, DISPATCHED, DELIVERED, CANCELLED] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200: { description: Orders fetched successfully }
 *       401: { description: Unauthorized }
 */
router.get('/', authenticate, auctionController.myOrders);

/**
 * @openapi
 * /orders/{orderId}:
 *   get:
 *     tags: [Orders]
 *     summary: One order, with its device, delivery address and status
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Order fetched successfully }
 *       404: { description: Order not found }
 */
router.get('/:orderId', authenticate, auctionController.getOrder);

module.exports = router;
