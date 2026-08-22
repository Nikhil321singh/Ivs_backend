const asyncHandler = require('../../helpers/asyncHandler');
const { successResponse } = require('../../helpers/apiResponse');
const httpStatus = require('../../constants/httpStatus');
const MESSAGES = require('../../constants/messages');
const adminService = require('../services/admin.service');
const settingsService = require('../../services/settings.service');
const notificationService = require('../../services/notification.service');
const appVersionService = require('../../services/appVersion.service');
const fcmProvider = require('../../services/providers/fcmProvider');
const { SETTING_DEFINITIONS } = require('../../constants/settings');
const { CAMPAIGN_STATUS } = require('../../constants/notification');

const login = asyncHandler(async (req, res) => {
  const { admin, token } = await adminService.login(req.body.email, req.body.password);

  successResponse(res, httpStatus.OK, MESSAGES.ADMIN.LOGGED_IN, { admin, token });
});

const me = asyncHandler(async (req, res) => {
  successResponse(res, httpStatus.OK, MESSAGES.ADMIN.PROFILE_FETCHED, { admin: req.admin });
});

/**
 * Returns current values alongside the definitions, so the portal can render
 * labels, descriptions and input types without hard-coding them client-side.
 */
const getSettings = asyncHandler(async (req, res) => {
  const settings = await settingsService.getAll();

  successResponse(res, httpStatus.OK, MESSAGES.ADMIN.SETTINGS_FETCHED, {
    settings,
    definitions: SETTING_DEFINITIONS,
  });
});

const updateSettings = asyncHandler(async (req, res) => {
  const { applied, settings } = await settingsService.update(req.body, req.admin._id);

  // eslint-disable-next-line no-console
  console.warn('[Admin] Settings changed', {
    by: req.admin.email,
    applied,
  });

  successResponse(res, httpStatus.OK, MESSAGES.ADMIN.SETTINGS_UPDATED, {
    settings,
    definitions: SETTING_DEFINITIONS,
  });
});

const listTransactions = asyncHandler(async (req, res) => {
  const data = await adminService.listTransactions(req.query);

  successResponse(res, httpStatus.OK, MESSAGES.ADMIN.TRANSACTIONS_FETCHED, data);
});

const listImeiChecks = asyncHandler(async (req, res) => {
  const data = await adminService.listImeiChecks(req.query);

  successResponse(res, httpStatus.OK, MESSAGES.ADMIN.IMEI_CHECKS_FETCHED, data);
});

const listUsers = asyncHandler(async (req, res) => {
  const data = await adminService.listUsers(req.query);

  successResponse(res, httpStatus.OK, MESSAGES.ADMIN.USERS_FETCHED, data);
});

const getUser = asyncHandler(async (req, res) => {
  const data = await adminService.getUserDetail(req.params.userId);

  successResponse(res, httpStatus.OK, MESSAGES.ADMIN.USER_FETCHED, data);
});

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */

/**
 * Sends a push + inbox notification to a chosen audience.
 *
 * Small audiences finish before this responds and come back COMPLETED with real
 * numbers; larger ones return QUEUED and finish in the background — poll
 * GET /admin/notifications/campaigns/:campaignId for progress either way.
 *
 * `pushEnabled: false` in the response means the server has no Firebase
 * credentials: the notifications were still written to every recipient's inbox,
 * but no device was woken. Surfacing it here stops an operator from concluding
 * the send worked when nobody's phone buzzed.
 */
const sendNotification = asyncHandler(async (req, res) => {
  const campaign = await notificationService.sendCampaign({
    ...req.body,
    adminId: req.admin._id,
  });

  // eslint-disable-next-line no-console
  console.warn('[Admin] Notification broadcast', {
    by: req.admin.email,
    campaignId: String(campaign._id),
    targeted: campaign.stats.targeted,
    mode: campaign.audience.mode,
  });

  const completed = campaign.status === CAMPAIGN_STATUS.COMPLETED;

  const message = campaign.stats.targeted === 0
    ? MESSAGES.NOTIFICATION.NO_AUDIENCE
    : (completed ? MESSAGES.NOTIFICATION.SENT : MESSAGES.NOTIFICATION.QUEUED);

  successResponse(res, httpStatus.OK, message, {
    campaign,
    pushEnabled: fcmProvider.isConfigured(),
  });
});

const listCampaigns = asyncHandler(async (req, res) => {
  const data = await notificationService.listCampaigns(req.query);

  successResponse(res, httpStatus.OK, MESSAGES.NOTIFICATION.CAMPAIGNS_FETCHED, data);
});

const getCampaign = asyncHandler(async (req, res) => {
  const campaign = await notificationService.getCampaign(req.params.campaignId);

  successResponse(res, httpStatus.OK, MESSAGES.NOTIFICATION.CAMPAIGN_FETCHED, { campaign });
});

/* ------------------------------------------------------------------ *
 * App versions
 * ------------------------------------------------------------------ */

const listAppVersions = asyncHandler(async (req, res) => {
  const versions = await appVersionService.listConfigs();

  successResponse(res, httpStatus.OK, MESSAGES.APP_VERSION.FETCHED, { versions });
});

/**
 * Publishes a release for one platform, and optionally tells users about it.
 *
 * `notify: true` folds the announcement into the same call, because publishing
 * and announcing are one action in practice and doing them separately invites
 * forgetting the second half. The push goes only to users whose registered
 * device is behind the new version.
 */
const upsertAppVersion = asyncHandler(async (req, res) => {
  const { notify, ...patch } = req.body;

  const version = await appVersionService.upsertConfig(
    req.params.platform,
    patch,
    req.admin._id
  );

  // eslint-disable-next-line no-console
  console.warn('[Admin] App version published', {
    by: req.admin.email,
    platform: version.platform,
    latestVersion: version.latestVersion,
    minSupportedVersion: version.minSupportedVersion,
    mandatory: version.mandatory,
  });

  let campaign = null;
  if (notify) {
    ({ campaign } = await appVersionService.notifyOutdatedUsers({
      platform: version.platform,
      adminId: req.admin._id,
    }));
  }

  successResponse(res, httpStatus.OK, MESSAGES.APP_VERSION.SAVED, {
    version,
    campaign,
    pushEnabled: fcmProvider.isConfigured(),
  });
});

/** Announces the published release on its own, without editing it. */
const notifyAppUpdate = asyncHandler(async (req, res) => {
  const { campaign, config } = await appVersionService.notifyOutdatedUsers({
    platform: req.params.platform,
    title: req.body.title,
    body: req.body.body,
    adminId: req.admin._id,
  });

  successResponse(res, httpStatus.OK, MESSAGES.APP_VERSION.UPDATE_NOTIFIED, {
    campaign,
    version: config,
    pushEnabled: fcmProvider.isConfigured(),
  });
});

const getStats = asyncHandler(async (req, res) => {
  const stats = await adminService.getStats();

  successResponse(res, httpStatus.OK, MESSAGES.ADMIN.STATS_FETCHED, stats);
});

module.exports = {
  login,
  me,
  getSettings,
  updateSettings,
  listTransactions,
  listImeiChecks,
  listUsers,
  getUser,
  getStats,
  sendNotification,
  listCampaigns,
  getCampaign,
  listAppVersions,
  upsertAppVersion,
  notifyAppUpdate,
};
