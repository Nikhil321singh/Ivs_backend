const express = require('express');
const entitlementController = require('../controllers/entitlement.controller');
const authenticate = require('../middleware/auth.middleware');

const router = express.Router();

/**
 * @openapi
 * /entitlements:
 *   get:
 *     tags: [Entitlements]
 *     summary: The caller's remaining credits, per feature, plus lifetime stats
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Credits fetched successfully }
 *       401: { description: Unauthorized }
 */
router.get('/', authenticate, entitlementController.getEntitlement);

/**
 * @openapi
 * /entitlements/transactions:
 *   get:
 *     tags: [Entitlements]
 *     summary: Paginated credit ledger (grants and consumption)
 *     description: >
 *       Every movement of every credit, newest first. This is what answers
 *       "where did my 20 IMEI checks go" — one row per feature per event.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: feature
 *         schema: { type: string, example: IVS_CHECK }
 *         description: Restrict to a single feature.
 *     responses:
 *       200: { description: Credit history fetched successfully }
 *       401: { description: Unauthorized }
 */
router.get('/transactions', authenticate, entitlementController.getTransactions);

module.exports = router;
