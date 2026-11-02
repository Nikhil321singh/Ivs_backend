const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const biddingKycService = require('../services/biddingKyc.service');

const submit = asyncHandler(async (req, res) => {
  const application = await biddingKycService.submitBiddingKyc(
    req.user._id,
    req.body,
    req.files
  );

  successResponse(res, httpStatus.CREATED, MESSAGES.BIDDING_KYC.SUBMITTED, { application });
});

const getStatus = asyncHandler(async (req, res) => {
  const application = await biddingKycService.getForUser(req.user._id);

  successResponse(res, httpStatus.OK, MESSAGES.BIDDING_KYC.FETCHED, { application });
});

module.exports = { submit, getStatus };
