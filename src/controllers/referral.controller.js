const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const referralService = require('../services/referral.service');

const getMyReferral = asyncHandler(async (req, res) => {
  const summary = await referralService.getReferralSummary(req.user);

  successResponse(res, httpStatus.OK, MESSAGES.REFERRAL.FETCHED, summary);
});

module.exports = { getMyReferral };
