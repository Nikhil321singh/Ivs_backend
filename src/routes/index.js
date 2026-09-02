const express = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const ivsRoutes = require('./ivs.routes');
const walletRoutes = require('./wallet.routes');
const referralRoutes = require('./referral.routes');
const diagnoseRoutes = require('./diagnose.routes');
const notificationRoutes = require('./notification.routes');
const appRoutes = require('./app.routes');
const wrapperRoutes = require('./wrapper.routes');
// Self-contained admin module — see src/admin/README.md.
const adminModule = require('../admin');
const PRICING = require('../constants/pricing');
const settingsService = require('../services/settings.service');
const asyncHandler = require('../helpers/asyncHandler');

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
router.get(
  '/pricing',
  asyncHandler(async (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Pricing fetched successfully.',
      data: {
        tokenPerInr: PRICING.TOKEN_PER_INR,
        // Effective prices, including any operator override set in the admin
        // console — so the app never quotes a price different from the one it
        // will be charged.
        features: await settingsService.getFeatureCosts(),
        referral: PRICING.REFERRAL,
        // Lets the client advertise the joining offer without hard-coding the
        // number, so changing it here changes it in the app too.
        signupBonus: PRICING.SIGNUP_BONUS,
      },
    });
  })
);

/**
 * @openapi
 * /settings:
 *   get:
 *     tags: [Settings]
 *     summary: Public feature flags
 *     description: Unauthenticated. Lets a client decide which onboarding steps to show — e.g. hide the KYC screen when kycRequired is false, or the Aadhaar step when aadhaarVerificationEnabled is false. Values are operator-controlled from the admin console and change without a deploy.
 *     responses:
 *       200: { description: Settings fetched successfully }
 */
router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const settings = await settingsService.getPublic();

    res.status(200).json({
      success: true,
      message: 'Settings fetched successfully.',
      data: settings,
    });
  })
);

router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/ivs', ivsRoutes);
router.use('/wallet', walletRoutes);
router.use('/referral', referralRoutes);
router.use('/diagnose', diagnoseRoutes);
router.use('/notifications', notificationRoutes);
// Client-facing app metadata (the launch-time update check). Unauthenticated —
// see routes/app.routes.js.
router.use('/app', appRoutes);
// Server-to-server only — authenticated by a shared secret in the body, not by
// a user session. See wrapper.routes.js.
router.use('/wrapper', wrapperRoutes);
router.use('/admin', adminModule.router);

module.exports = router;
