const express = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const ivsRoutes = require('./ivs.routes');
const walletRoutes = require('./wallet.routes');
const referralRoutes = require('./referral.routes');
const diagnoseRoutes = require('./diagnose.routes');
const mediaRoutes = require('./media.routes');
const PRICING = require('../constants/pricing');

const router = express.Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: API health check
 *     responses:
 *       200: { description: API is healthy }
 */
router.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'IVS API is healthy.', data: {} });
});

/**
 * @openapi
 * /pricing:
 *   get:
 *     tags: [Pricing]
 *     summary: Per-feature token costs and referral rewards
 *     responses:
 *       200: { description: Pricing fetched successfully }
 */
router.get('/pricing', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Pricing fetched successfully.',
    data: {
      tokenPerInr: PRICING.TOKEN_PER_INR,
      features: PRICING.FEATURES,
      referral: PRICING.REFERRAL,
    },
  });
});

router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/ivs', ivsRoutes);
router.use('/wallet', walletRoutes);
router.use('/referral', referralRoutes);
router.use('/diagnose', diagnoseRoutes);
router.use('/media', mediaRoutes);

module.exports = router;
