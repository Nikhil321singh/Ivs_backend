const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const appVersionService = require('../services/appVersion.service');

/**
 * The launch check: "I am android 1.3.0 — do I need to update?"
 *
 * Unauthenticated on purpose. It runs before the splash screen, on a client
 * that may be too old to hold a valid session, and forcing a login first would
 * make the update wall unreachable for exactly the users who need it.
 */
const check = asyncHandler(async (req, res) => {
  const status = await appVersionService.checkForUpdate({
    platform: req.query.platform,
    // `version` is the documented name; `currentVersion` and `appVersion` are
    // accepted too, because three clients will each guess a different one.
    currentVersion: req.query.version || req.query.currentVersion || req.query.appVersion,
  });

  successResponse(res, httpStatus.OK, MESSAGES.APP_VERSION.CHECKED, status);
});

module.exports = { check };
