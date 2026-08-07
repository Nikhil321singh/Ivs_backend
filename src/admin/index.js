const path = require('path');

/**
 * The admin module's ONLY integration point with the core API.
 *
 * Everything admin-specific lives under src/admin/ so this folder can be lifted
 * into its own repository later — see src/admin/README.md for exactly what that
 * takes. Keep this seam narrow: the rest of the app should never reach into
 * src/admin/** directly, and admin code should depend on core only through the
 * shared modules listed in that README.
 *
 * Consumed in two places:
 *   src/routes/index.js  ->  router.use('/admin', adminModule.router)
 *   src/app.js           ->  express.static(adminModule.publicDir)
 */
module.exports = {
  // Mounted under /api/v1/admin.
  router: require('./routes/admin.routes'),

  // The portal's static assets, served at /admin.
  publicDir: path.join(__dirname, 'public'),
};
