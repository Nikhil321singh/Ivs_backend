const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const adminService = require('../services/admin.service');
const settingsService = require('../services/settings.service');
const { SETTING_DEFINITIONS } = require('../constants/settings');

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
  getStats,
};
