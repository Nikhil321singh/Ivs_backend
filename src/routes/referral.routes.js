const express = require('express');
const referralController = require('../controllers/referral.controller');
const authenticate = require('../middleware/auth.middleware');

const router = express.Router();

/**
 * @openapi
 * /referral:
 *   get:
 *     tags: [Referral]
 *     summary: Get my referral code and earnings
 *     description: Share the returned referralCode. When a new user signs up with it and makes their first token top-up, you earn bonus tokens.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Referral details fetched successfully }
 *       401: { description: Unauthorized }
 */
router.get('/', authenticate, referralController.getMyReferral);

module.exports = router;
