const express = require('express');
const appVersionController = require('../controllers/appVersion.controller');
const validateRequest = require('../middleware/validateRequest.middleware');
const { checkUpdateValidator } = require('../validators/appVersion.validator');

const router = express.Router();

/**
 * @openapi
 * /app/version:
 *   get:
 *     tags: [App]
 *     summary: Should this build update?
 *     description: >-
 *       Unauthenticated, and meant to be called on every launch before the
 *       session is restored — an app old enough to need forcing may be too old
 *       to hold a valid token.
 *
 *
 *       `updateAction` is the field to switch on:
 *
 *       * `NONE` — up to date, show nothing.
 *
 *       * `OPTIONAL` — offer the update, let the user dismiss it.
 *
 *       * `FORCE` — block the app behind an update wall. Returned when the build
 *         is below `minSupportedVersion`, or when the operator marked the current
 *         release mandatory.
 *
 *
 *       Anything the server cannot judge (no release published, an unparseable
 *       version) resolves to `NONE`, so a misconfiguration can never lock users
 *       out of the app.
 *     parameters:
 *       - { in: query, name: platform, required: true, schema: { type: string, enum: [android, ios, web] } }
 *       - { in: query, name: version, schema: { type: string, example: "1.3.0" }, description: "The running build. Omit only if the client genuinely cannot report it — a missing version is treated as out of date (OPTIONAL)." }
 *     responses:
 *       200:
 *         description: App version checked successfully
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
 *                     platform: { type: string, example: android }
 *                     currentVersion: { type: string, example: "1.3.0", nullable: true }
 *                     updateAvailable: { type: boolean, example: true }
 *                     updateAction: { type: string, enum: [NONE, OPTIONAL, FORCE], example: FORCE }
 *                     forceUpdate: { type: boolean, example: true }
 *                     latestVersion: { type: string, example: "1.4.2", nullable: true }
 *                     minSupportedVersion: { type: string, example: "1.4.0", nullable: true }
 *                     releaseNotes: { type: string, nullable: true }
 *                     storeUrl: { type: string, example: "https://play.google.com/store/apps/details?id=in.grest.ivs" }
 *       422: { description: Validation failed — unknown or missing platform }
 */
router.get('/version', checkUpdateValidator, validateRequest, appVersionController.check);

module.exports = router;
