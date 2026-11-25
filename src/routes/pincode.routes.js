const express = require('express');
const pincodeController = require('../controllers/pincode.controller');

const router = express.Router();

/**
 * @openapi
 * /pincode/{pincode}:
 *   get:
 *     tags: [Pincode]
 *     summary: Get state and district by Indian pincode
 *     description: Unauthenticated. Returns the state/UT, district and division for a valid 6-digit Indian pincode.
 *     parameters:
 *       - in: path
 *         name: pincode
 *         required: true
 *         schema: { type: string, pattern: '^\d{6}$' }
 *         example: "110001"
 *     responses:
 *       200: { description: Pincode details fetched successfully }
 *       404: { description: Pincode not found }
 *       503: { description: Lookup service unavailable }
 */
router.get('/:pincode', pincodeController.lookup);

module.exports = router;
