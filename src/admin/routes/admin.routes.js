const express = require('express');
const adminController = require('../controllers/admin.controller');
const adminAuth = require('../middleware/adminAuth.middleware');
const validateRequest = require('../../middleware/validateRequest.middleware');
const { adminLoginLimiter } = require('../../middleware/rateLimiter.middleware');
const {
  loginValidator,
  updateSettingsValidator,
  userIdParamValidator,
  sendNotificationValidator,
  campaignIdParamValidator,
} = require('../validators/admin.validator');
const {
  upsertAppVersionValidator,
  notifyUpdateValidator,
} = require('../../validators/appVersion.validator');

const router = express.Router();

/**
 * @openapi
 * /admin/login:
 *   post:
 *     tags: [Admin]
 *     summary: Sign in to the admin portal
 *     description: Email + password. Returns an admin JWT carrying typ=admin; user tokens are never accepted on /admin routes.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, example: "admin@grest.in" }
 *               password: { type: string, example: "••••••••" }
 *     responses:
 *       200: { description: Signed in }
 *       401: { description: Invalid email or password }
 */
router.post('/login', adminLoginLimiter, loginValidator, validateRequest, adminController.login);

/**
 * @openapi
 * /admin/me:
 *   get:
 *     tags: [Admin]
 *     summary: Current admin profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile fetched }
 */
router.get('/me', adminAuth, adminController.me);

/**
 * @openapi
 * /admin/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Dashboard counters
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Stats fetched }
 */
router.get('/stats', adminAuth, adminController.getStats);

/**
 * @openapi
 * /admin/settings:
 *   get:
 *     tags: [Admin]
 *     summary: Current runtime settings and their definitions
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Settings fetched }
 *   patch:
 *     tags: [Admin]
 *     summary: Update runtime settings
 *     description: Partial patch. Takes effect within seconds across the API without a restart. Turning aadhaarVerificationEnabled off makes Aadhaar optional on every endpoint.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               aadhaarVerificationEnabled: { type: boolean, example: false }
 *     responses:
 *       200: { description: Settings updated }
 *       422: { description: Unknown setting or wrong value type }
 */
router.get('/settings', adminAuth, adminController.getSettings);
router.patch(
  '/settings',
  adminAuth,
  updateSettingsValidator,
  validateRequest,
  adminController.updateSettings
);

/**
 * @openapi
 * /admin/transactions:
 *   get:
 *     tags: [Admin]
 *     summary: Wallet ledger across all users
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: type, schema: { type: string, enum: [CREDIT, DEBIT] } }
 *       - { in: query, name: reason, schema: { type: string, example: FEATURE_CHARGE } }
 *     responses:
 *       200: { description: Transactions fetched }
 */
router.get('/transactions', adminAuth, adminController.listTransactions);

/**
 * @openapi
 * /admin/imei-checks:
 *   get:
 *     tags: [Admin]
 *     summary: IMEI verification audit log across all users
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: status, schema: { type: string, enum: [CLEAN, BLOCKED, STOLEN, UNKNOWN, ERROR] } }
 *     responses:
 *       200: { description: IMEI checks fetched }
 */
router.get('/imei-checks', adminAuth, adminController.listImeiChecks);

/**
 * @openapi
 * /admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: User directory — searchable, filterable, newest first
 *     description: >-
 *       Each row carries the user's wallet balance alongside their profile, so the
 *       list is useful without opening each account. `search` matches any one of
 *       mobile, name, company name, email, PAN, GST or referral code
 *       (case-insensitive, partial).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *       - { in: query, name: search, schema: { type: string }, description: "Mobile, name, company, email, PAN, GST or referral code" }
 *       - { in: query, name: kycCompleted, schema: { type: boolean } }
 *       - { in: query, name: userType, schema: { type: string, enum: [vendor, individual] } }
 *       - { in: query, name: status, schema: { type: string, enum: [ACTIVE, BLOCKED] } }
 *     responses:
 *       200: { description: Users fetched successfully }
 *       401: { description: Admin authentication required }
 */
router.get('/users', adminAuth, adminController.listUsers);

/**
 * @openapi
 * /admin/users/{userId}:
 *   get:
 *     tags: [Admin]
 *     summary: Everything about one user — profile, KYC, wallet, referrals, activity totals and recent records
 *     description: >-
 *       The same payload the user sees at /user/me, plus a `recent` block holding
 *       their last 20 IMEI checks (with device model and IMEIs), last 20 wallet
 *       ledger movements and last 20 top-up orders. For the complete history use
 *       the paginated /admin/imei-checks and /admin/transactions endpoints.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: userId, required: true, schema: { type: string }, description: Mongo id of the user }
 *     responses:
 *       200:
 *         description: User details fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user: { type: object }
 *                     kyc: { type: object }
 *                     wallet: { type: object }
 *                     referral: { type: object }
 *                     activity: { type: object }
 *                     account: { type: object }
 *                     recent:
 *                       type: object
 *                       properties:
 *                         imeiChecks: { type: array, items: { type: object } }
 *                         transactions: { type: array, items: { type: object } }
 *                         payments: { type: array, items: { type: object } }
 *       401: { description: Admin authentication required }
 *       404: { description: User not found }
 *       422: { description: Malformed user id }
 */
router.get(
  '/users/:userId',
  adminAuth,
  userIdParamValidator,
  validateRequest,
  adminController.getUser
);

/**
 * @openapi
 * /admin/notifications/send:
 *   post:
 *     tags: [Admin]
 *     summary: Send a push notification to a chosen audience
 *     description: >-
 *       Writes the notification to every recipient's in-app inbox and pushes it
 *       to their registered devices via FCM. The inbox write is the record — a
 *       device that is off, uninstalled or unregistered simply misses the push
 *       and sees the message on next open.
 *
 *
 *       Audience modes:
 *
 *       * `ALL` (default) — every active user.
 *
 *       * `USER_IDS` — an explicit list, e.g. one user after a support call.
 *
 *       * `FILTER` — by `userType`, `kycCompleted`, and/or `platform` (users with
 *         a registered device on that platform).
 *
 *
 *       Blocked and deleted accounts are excluded from every mode. Sends to 500
 *       users or fewer complete before this responds (`status: COMPLETED` with
 *       real counts); larger ones return `QUEUED` and continue in the background
 *       — poll `/admin/notifications/campaigns/{campaignId}` for progress.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, body]
 *             properties:
 *               title: { type: string, maxLength: 120, example: "Scheduled maintenance tonight" }
 *               body: { type: string, maxLength: 500, example: "IMEI checks will be unavailable from 1–2 AM IST." }
 *               type:
 *                 type: string
 *                 enum: [APP_UPDATE, PROMOTIONAL, TRANSACTIONAL, WALLET, KYC, IVS, SYSTEM]
 *                 default: PROMOTIONAL
 *               imageUrl: { type: string, example: "https://cdn.example.com/banner.png" }
 *               data:
 *                 type: object
 *                 description: Routing payload handed to the app verbatim.
 *                 example: { screen: "WalletScreen" }
 *               audience:
 *                 type: object
 *                 properties:
 *                   mode: { type: string, enum: [ALL, USER_IDS, FILTER], default: ALL }
 *                   userIds: { type: array, items: { type: string }, description: Required for mode USER_IDS }
 *                   filter:
 *                     type: object
 *                     properties:
 *                       userType: { type: string, enum: [vendor, individual] }
 *                       kycCompleted: { type: boolean }
 *                       platform: { type: string, enum: [android, ios, web] }
 *     responses:
 *       200:
 *         description: Notification sent (or queued for a large audience)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     campaign:
 *                       type: object
 *                       properties:
 *                         id: { type: string }
 *                         status: { type: string, enum: [QUEUED, SENDING, COMPLETED, FAILED] }
 *                         stats:
 *                           type: object
 *                           properties:
 *                             targeted: { type: integer, description: Users the audience resolved to }
 *                             delivered: { type: integer, description: Inbox rows written }
 *                             devices: { type: integer, description: Device tokens attempted }
 *                             pushSuccess: { type: integer }
 *                             pushFailed: { type: integer }
 *                     pushEnabled:
 *                       type: boolean
 *                       description: False when the server has no Firebase credentials — inbox only, no device push.
 *       401: { description: Admin authentication required }
 *       422: { description: Validation failed }
 */
router.post(
  '/notifications/send',
  adminAuth,
  sendNotificationValidator,
  validateRequest,
  adminController.sendNotification
);

/**
 * @openapi
 * /admin/notifications/campaigns:
 *   get:
 *     tags: [Admin]
 *     summary: Broadcast history with delivery stats
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200: { description: Notification campaigns fetched successfully }
 *       401: { description: Admin authentication required }
 */
router.get('/notifications/campaigns', adminAuth, adminController.listCampaigns);

/**
 * @openapi
 * /admin/notifications/campaigns/{campaignId}:
 *   get:
 *     tags: [Admin]
 *     summary: One broadcast, including live progress for a background send
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Notification campaign fetched successfully }
 *       404: { description: Notification campaign not found }
 */
router.get(
  '/notifications/campaigns/:campaignId',
  adminAuth,
  campaignIdParamValidator,
  validateRequest,
  adminController.getCampaign
);

/**
 * @openapi
 * /admin/app-versions:
 *   get:
 *     tags: [Admin]
 *     summary: Published release per platform
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: App versions fetched successfully }
 *       401: { description: Admin authentication required }
 */
router.get('/app-versions', adminAuth, adminController.listAppVersions);

/**
 * @openapi
 * /admin/app-versions/{platform}:
 *   put:
 *     tags: [Admin]
 *     summary: Publish or edit the release for a platform
 *     description: >-
 *       Drives GET /app/version, which every client calls at launch.
 *
 *
 *       * `latestVersion` — what the store is serving. Clients below it are
 *         offered an update.
 *
 *       * `minSupportedVersion` — the oldest build still allowed to run. Clients
 *         below it are FORCED to update. Leave empty to never force.
 *
 *       * `mandatory` — force everyone below `latestVersion`, not just below the
 *         minimum. The switch for the day a released build turns out to be
 *         harmful.
 *
 *
 *       A `minSupportedVersion` newer than `latestVersion` is refused: it would
 *       wall off every user with nothing to update to. Set `notify: true` to
 *       announce the release in the same call — only users on an older build are
 *       notified.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: platform, required: true, schema: { type: string, enum: [android, ios, web] } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latestVersion]
 *             properties:
 *               latestVersion: { type: string, example: "1.4.2" }
 *               minSupportedVersion: { type: string, example: "1.4.0", nullable: true }
 *               mandatory: { type: boolean, default: false }
 *               releaseNotes: { type: string, example: "Faster IMEI checks and a fix for wallet receipts." }
 *               storeUrl: { type: string, example: "https://play.google.com/store/apps/details?id=in.grest.ivs" }
 *               notify: { type: boolean, default: false, description: Also push an update notice to users on an older build. }
 *     responses:
 *       200: { description: App version saved successfully }
 *       401: { description: Admin authentication required }
 *       422: { description: Validation failed, or minSupportedVersion is newer than latestVersion }
 */
router.put(
  '/app-versions/:platform',
  adminAuth,
  upsertAppVersionValidator,
  validateRequest,
  adminController.upsertAppVersion
);

/**
 * @openapi
 * /admin/app-versions/{platform}/notify:
 *   post:
 *     tags: [Admin]
 *     summary: Push "update available" to users on an older build
 *     description: >-
 *       Targets only users whose registered device on this platform reports a
 *       version older than the published release (a device that never reported
 *       one counts as old). Nobody already up to date is notified.
 *
 *
 *       The notification's `data` carries `latestVersion`, `storeUrl` and
 *       `forceUpdate`, so tapping it can open the store or raise the update wall
 *       with no further API call.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: platform, required: true, schema: { type: string, enum: [android, ios, web] } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string, example: "Update available", description: Defaults to a standard update title. }
 *               body: { type: string, description: Defaults to a message built from the version and release notes. }
 *     responses:
 *       200: { description: Update notification sent to users on an older version }
 *       404: { description: No release has been published for this platform yet }
 */
router.post(
  '/app-versions/:platform/notify',
  adminAuth,
  notifyUpdateValidator,
  validateRequest,
  adminController.notifyAppUpdate
);

module.exports = router;
