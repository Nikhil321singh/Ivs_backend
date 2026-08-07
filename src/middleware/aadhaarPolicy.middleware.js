const asyncHandler = require('../helpers/asyncHandler');
const settingsService = require('../services/settings.service');

/**
 * Publishes the Aadhaar kill switch onto the request as `req.aadhaarRequired`.
 *
 * express-validator's `.if()` predicates are synchronous, so a validator can't
 * await the setting itself. Running this first turns the async lookup into a
 * plain boolean the validator chain can read — which is what lets
 * `aadhaarNumber` stop being a required field while the switch is off.
 *
 * Must be mounted before any validator that branches on it.
 */
const loadAadhaarPolicy = asyncHandler(async (req, res, next) => {
  req.aadhaarRequired = await settingsService.isAadhaarVerificationEnabled();
  next();
});

module.exports = loadAadhaarPolicy;
