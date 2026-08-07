/**
 * The admin module's ONLY integration point with the core API.
 *
 * Everything admin-specific lives under src/admin/ so this folder can be lifted
 * into its own repository later — see src/admin/README.md for exactly what that
 * takes. Keep this seam narrow: the rest of the app should never reach into
 * src/admin/** directly, and admin code should depend on core only through the
 * shared modules listed in that README.
 *
 * The console UI is NOT here — it lives in its own repo (ivs-admin-frontend)
 * and is deployed as a static site. This module is the API half only, so the
 * console's origin must be allowed through CORS via the ADMIN_URL env var.
 *
 * Consumed in one place:
 *   src/routes/index.js  ->  router.use('/admin', adminModule.router)
 */
module.exports = {
  // Mounted under /api/v1/admin.
  router: require('./routes/admin.routes'),
};
