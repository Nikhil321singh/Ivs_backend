const asyncHandler = require('../helpers/asyncHandler');
const settingsService = require('../services/settings.service');

/**
 * Publishes the runtime kill switches onto the request as plain booleans:
 *   req.aadhaarRequired  — Aadhaar verification enabled
 *   req.kycRequired      — KYC mandatory
 *
 * express-validator's `.if()` predicates and chain selection are synchronous,
 * so a validator cannot await these itself. Resolving them here is what lets
 * `aadhaarNumber` stop being required, and lets completeKycValidator swap to a
 * fully-optional chain, while a switch is off.
 *
 * Must be mounted before any validator that branches on them.
 */
const loadPolicy = asyncHandler(async (req, res, next) => {
  const [aadhaarRequired, kycRequired] = await Promise.all([
    settingsService.isAadhaarVerificationEnabled(),
    settingsService.isKycRequired(),
  ]);

  req.aadhaarRequired = aadhaarRequired;
  req.kycRequired = kycRequired;
  next();
});

module.exports = loadPolicy;
