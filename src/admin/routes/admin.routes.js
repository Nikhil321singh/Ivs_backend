const express = require('express');
const adminController = require('../controllers/admin.controller');
const adminAuth = require('../middleware/adminAuth.middleware');
const validateRequest = require('../../middleware/validateRequest.middleware');
const { uploadAuctionPhotos } = require('../../middleware/upload.middleware');
const { adminLoginLimiter } = require('../../middleware/rateLimiter.middleware');
const {
  loginValidator,
  updateSettingsValidator,
  userIdParamValidator,
  sendNotificationValidator,
  campaignIdParamValidator,
  planIdParamValidator,
  createPlanValidator,
  updatePlanValidator,
  adjustCreditsValidator,
  adminAuctionIdParamValidator,
  takeDownAuctionValidator,
  lookupImeiValidator,
  createListingValidator,
  updateListingValidator,
  updateOrderValidator,
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

/* ------------------------------------------------------------------ *
 * Credit packs. See SUBSCRIPTION_DESIGN.md §8 — plans, quantities and
 * prices are data edited from here, never constants in the codebase.
 * ------------------------------------------------------------------ */

/**
 * @openapi
 * /admin/plans:
 *   get:
 *     tags: [Admin]
 *     summary: Every credit pack, active or not
 *     description: Each plan is returned with the same computed maths the app sees — effective per-check rate, discount and derived MRP — plus the custom tier's current rules.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Plans fetched successfully }
 *   post:
 *     tags: [Admin]
 *     summary: Create a credit pack
 *     description: >
 *       Rejected with 422 if the price would make this pack cheaper per check
 *       than the custom tier — that inverts the pricing ladder, making a small
 *       pack better value than buying in volume. A merely flat ladder succeeds
 *       and returns `warnings`.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name, tier, quotas, pricePaise]
 *             properties:
 *               code: { type: string, example: "PRO_MAX" }
 *               name: { type: string, example: "Pro Max" }
 *               tier: { type: string, enum: [BASIC, PRO, PRO_MAX, CUSTOM] }
 *               quotas: { type: object, example: { IVS_CHECK: 40, DIAGNOSE: 30 } }
 *               pricePaise: { type: integer, example: 169900 }
 *               mrpPaise: { type: integer, description: "Strikethrough anchor. Omit to derive it from the list unit prices." }
 *               badge: { type: string, example: "Most popular" }
 *               highlight: { type: boolean }
 *               sortOrder: { type: integer }
 *               audience: { type: string, enum: [individual, vendor, all] }
 *               isActive: { type: boolean }
 *     responses:
 *       201: { description: Plan created successfully }
 *       409: { description: A plan with this code already exists }
 *       422: { description: The price breaks the pricing ladder }
 */
router.get('/plans', adminAuth, adminController.listPlans);
router.post('/plans', adminAuth, createPlanValidator, validateRequest, adminController.createPlan);

/**
 * @openapi
 * /admin/plans/{planId}:
 *   patch:
 *     tags: [Admin]
 *     summary: Edit a credit pack (quantities, price, badge, ordering, active)
 *     description: >
 *       Any subset of fields. `code` is not editable — it is the identity seed
 *       scripts and reports address the plan by. Deactivate with
 *       `isActive: false` rather than deleting: purchases keep their own
 *       snapshot, but history views still need the plan to resolve.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Plan updated successfully }
 *       404: { description: Plan not found }
 *       422: { description: The price breaks the pricing ladder }
 */
router.patch(
  '/plans/:planId',
  adminAuth,
  planIdParamValidator,
  updatePlanValidator,
  validateRequest,
  adminController.updatePlan
);

/**
 * @openapi
 * /admin/entitlements/{userId}:
 *   get:
 *     tags: [Admin]
 *     summary: A customer's remaining credits, lifetime stats and recent movements
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Credits fetched successfully }
 *       404: { description: User not found }
 */
router.get(
  '/entitlements/:userId',
  adminAuth,
  userIdParamValidator,
  validateRequest,
  adminController.getUserEntitlement
);

/**
 * @openapi
 * /admin/entitlements/{userId}/adjust:
 *   post:
 *     tags: [Admin]
 *     summary: Grant or deduct credits manually
 *     description: >
 *       For refunds, goodwill and disputed checks. Never writes the counter
 *       directly — it goes through the same path as a purchase, writing an
 *       ADMIN_ADJUSTMENT ledger row stamped with the acting admin and the note.
 *       The note is required: there is no role separation on admin accounts, so
 *       this trail is the only control on an operator minting free credits.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [feature, delta, note]
 *             properties:
 *               feature: { type: string, example: "IVS_CHECK" }
 *               delta: { type: integer, example: 5, description: "Positive grants, negative deducts. Never zero." }
 *               note: { type: string, example: "Refund for failed check REF-123" }
 *     responses:
 *       200: { description: Credits adjusted successfully }
 *       402: { description: Deduction exceeds the customer's remaining credits }
 *       404: { description: User not found }
 */
router.post(
  '/entitlements/:userId/adjust',
  adminAuth,
  adjustCreditsValidator,
  validateRequest,
  adminController.adjustCredits
);

/**
 * @openapi
 * /admin/subscriptions:
 *   get:
 *     tags: [Admin]
 *     summary: Credit pack purchases, with captured revenue over the same filter
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [CREATED, PAID, FAILED, REFUNDED] }
 *       - in: query
 *         name: planCode
 *         schema: { type: string, example: "PRO_MAX" }
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Purchases fetched successfully }
 */
router.get('/subscriptions', adminAuth, adminController.listPlanPayments);

/* ------------------------------------------------------------------ *
 * Auctions. Read-only, except taking a listing down — an admin cannot
 * bid, reprice, or choose a winner. See AUCTION_DESIGN.md.
 * ------------------------------------------------------------------ */

/**
 * @openapi
 * /admin/auctions:
 *   get:
 *     tags: [Admin]
 *     summary: Every auction, including drafts customers never see
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, example: "LIVE,PAYMENT_PENDING" }
 *       - in: query
 *         name: sellerId
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches brand, model or IMEI.
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200: { description: Auctions fetched successfully }
 */
router.get('/auctions', adminAuth, adminController.listAuctions);

/**
 * @openapi
 * /admin/auctions:
 *   post:
 *     tags: [Admin]
 *     summary: Create a Grest listing (draft)
 *     description: >
 *       Grest's own stock, listed from the portal. Owned by the Grest system
 *       account and marked sellerType PLATFORM, so publishing it is never
 *       charged a listing credit. Every buyer-facing rule still applies — photos
 *       required, duration bounds, blocked/stolen IMEI refused.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [device, condition, startPricePaise, bidIncrementPaise, startAt, endAt]
 *             properties:
 *               device: { type: object }
 *               condition: { type: string, enum: [LIKE_NEW, EXCELLENT, GOOD, FAIR, POOR] }
 *               conditionNotes: { type: string }
 *               photos: { type: array, items: { type: object } }
 *               startPricePaise: { type: integer, example: 1000000 }
 *               bidIncrementPaise: { type: integer, example: 50000 }
 *               buyNowPricePaise: { type: integer, example: 2000000, description: "Optional instant buy price. Must exceed startPricePaise." }
 *               startAt: { type: string, format: date-time }
 *               endAt: { type: string, format: date-time }
 *     responses:
 *       201: { description: Draft created successfully }
 *       422: { description: Validation failed }
 */
router.post(
  '/auctions',
  adminAuth,
  createListingValidator,
  validateRequest,
  adminController.createListing
);

/**
 * @openapi
 * /admin/auctions/lookup-imei:
 *   post:
 *     tags: [Admin]
 *     summary: Look a handset up in Blancco before listing it
 *     description: >
 *       Reads the diagnostic report Blancco's app already uploaded for this
 *       IMEI — it does not run a diagnosis. Returns the report, form prefill
 *       (make, model, colour), the grade, and `sellable: false` when the device
 *       is still locked to an iCloud account or an MDM profile.
 *       404 means the handset has never been through the diagnostics app.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [imei]
 *             properties:
 *               imei: { type: string, example: "356370162838962" }
 *     responses:
 *       200: { description: Device report fetched }
 *       404: { description: No report exists for this IMEI }
 *       502: { description: Blancco could not be reached }
 *       503: { description: Diagnostics not configured }
 */
router.post(
  '/auctions/lookup-imei',
  adminAuth,
  lookupImeiValidator,
  validateRequest,
  adminController.lookupDeviceImei
);

/**
 * @openapi
 * /admin/auctions/{auctionId}:
 *   patch:
 *     tags: [Admin]
 *     summary: Edit a draft listing
 *     description: >
 *       Drafts only. Once published the terms are frozen — people bid against a
 *       price and a deadline, and moving either afterwards is the most abusable
 *       thing a marketplace can allow.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Listing updated successfully }
 *       409: { description: Listing is already published }
 */
router.patch(
  '/auctions/:auctionId',
  adminAuth,
  updateListingValidator,
  validateRequest,
  adminController.updateListing
);

/**
 * @openapi
 * /admin/auctions/{auctionId}/publish:
 *   post:
 *     tags: [Admin]
 *     summary: Publish a Grest listing (no credit charged)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Listing published }
 *       409: { description: Not a draft }
 *       422: { description: No photos, blocked IMEI, or duration out of bounds }
 */
/**
 * @openapi
 * /admin/auctions/{auctionId}/photos:
 *   post:
 *     tags: [Admin]
 *     summary: Upload device photos onto a Grest draft
 *     description: >
 *       Multipart, field name `photos`, up to 20 files per request and at most
 *       `auctionMaxPhotos` on the listing. JPG, PNG or WEBP, each under the
 *       configured size limit. The portal posts the files and this server puts
 *       them in S3 — the browser never needs AWS credentials.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photos:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       201: { description: Photos uploaded; returns the listing with photo ids and urls }
 *       400: { description: Too many photos, wrong type, or file too large }
 *       409: { description: Listing is already published }
 */
router.post(
  '/auctions/:auctionId/photos',
  adminAuth,
  adminAuctionIdParamValidator,
  validateRequest,
  uploadAuctionPhotos,
  adminController.addListingPhotos
);

/**
 * @openapi
 * /admin/auctions/{auctionId}/photos/{photoId}:
 *   delete:
 *     tags: [Admin]
 *     summary: Remove one photo from a draft
 *     description: Deletes the stored object too, so removing a photo does not orphan a file in S3.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Photo removed }
 *       404: { description: Photo not found on this listing }
 */
router.delete(
  '/auctions/:auctionId/photos/:photoId',
  adminAuth,
  adminAuctionIdParamValidator,
  validateRequest,
  adminController.removeListingPhoto
);

router.post(
  '/auctions/:auctionId/publish',
  adminAuth,
  adminAuctionIdParamValidator,
  validateRequest,
  adminController.publishListing
);

/**
 * @openapi
 * /admin/auctions/{auctionId}/relist:
 *   post:
 *     tags: [Admin]
 *     summary: Put an unsold or unpaid device back up as a fresh draft
 *     description: >
 *       Clones the listing rather than reopening it — the finished auction keeps
 *       its own bids and defaulters as a record of what happened. The new draft
 *       starts clean, so a bidder who failed to pay last time may bid again.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Relisted as a new draft }
 *       409: { description: That auction cannot be relisted }
 */
router.post(
  '/auctions/:auctionId/relist',
  adminAuth,
  adminAuctionIdParamValidator,
  validateRequest,
  adminController.relistAuction
);

/* ---- Orders: the fulfilment queue -------------------------------- */

/**
 * @openapi
 * /admin/orders:
 *   get:
 *     tags: [Admin]
 *     summary: Device orders — buyer, address, payment and delivery status
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, DISPATCHED, DELIVERED, CANCELLED] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches recipient name, phone or pincode.
 *     responses:
 *       200: { description: Orders fetched successfully }
 */
router.get('/orders', adminAuth, adminController.listOrders);

/**
 * @openapi
 * /admin/orders/settlement:
 *   get:
 *     tags: [Admin]
 *     summary: What Grest owes each vendor for sold devices
 *     description: >
 *       There is no automated payout — Grest collects the buyer's money and
 *       settles with vendors out of band. This is the view that says how much,
 *       to whom. Platform listings are excluded; Grest does not owe itself.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Settlement fetched successfully }
 */
router.get('/orders/settlement', adminAuth, adminController.vendorSettlement);

/**
 * @openapi
 * /admin/orders/{orderId}:
 *   patch:
 *     tags: [Admin]
 *     summary: Move an order along, or add a note
 *     description: >
 *       PENDING → DISPATCHED → DELIVERED, or CANCELLED from either of the first
 *       two. DELIVERED is terminal. The buyer is notified on every status change.
 *       Send a note alone to record something without moving the order.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [PENDING, DISPATCHED, DELIVERED, CANCELLED] }
 *               note: { type: string, example: "Handed to Bluedart, AWB 12345" }
 *     responses:
 *       200: { description: Order updated successfully }
 *       409: { description: That status transition is not allowed }
 */
router.patch(
  '/orders/:orderId',
  adminAuth,
  updateOrderValidator,
  validateRequest,
  adminController.updateOrder
);

/**
 * @openapi
 * /admin/auctions/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Auction dashboard counters
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Stats fetched successfully }
 */
router.get('/auctions/stats', adminAuth, adminController.getAuctionStats);

/**
 * @openapi
 * /admin/auctions/{auctionId}:
 *   get:
 *     tags: [Admin]
 *     summary: One auction with its seller, winner and recent bids
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: auctionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Auction fetched successfully }
 *       404: { description: Auction not found }
 */
router.get(
  '/auctions/:auctionId',
  adminAuth,
  adminAuctionIdParamValidator,
  validateRequest,
  adminController.getAuctionDetail
);

/**
 * @openapi
 * /admin/auctions/{auctionId}/bids:
 *   get:
 *     tags: [Admin]
 *     summary: Full bid history with bidders identified
 *     description: Unlike the customer-facing history, which shows first names only, this identifies every bidder — it is the view for investigating shill bidding.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Bid history fetched successfully }
 */
router.get(
  '/auctions/:auctionId/bids',
  adminAuth,
  adminAuctionIdParamValidator,
  validateRequest,
  adminController.getAuctionBids
);

/**
 * @openapi
 * /admin/auctions/{auctionId}/takedown:
 *   post:
 *     tags: [Admin]
 *     summary: Remove a listing, even one with live bids
 *     description: >
 *       For a stolen handset, a fraudulent listing or an abusive description.
 *       Unlike the seller's own cancel this works mid-auction, which is the
 *       point — but everyone who bid is notified, and the reason is recorded.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string, example: "IMEI reported stolen by CEIR" }
 *     responses:
 *       200: { description: Auction removed successfully }
 *       409: { description: Auction is already closed }
 *       422: { description: A reason is required }
 */
router.post(
  '/auctions/:auctionId/takedown',
  adminAuth,
  takeDownAuctionValidator,
  validateRequest,
  adminController.takeDownAuction
);

module.exports = router;
