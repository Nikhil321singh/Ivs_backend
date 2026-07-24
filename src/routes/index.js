const express = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const ivsRoutes = require('./ivs.routes');

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

router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/ivs', ivsRoutes);

module.exports = router;
