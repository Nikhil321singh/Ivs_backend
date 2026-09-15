const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const planService = require('../services/plan.service');

/**
 * The plan cards, fully computed server-side — price, strikethrough MRP,
 * discount, per-check rate, badge and ordering. The client renders what this
 * returns and calculates nothing, so a pricing experiment never needs an app
 * release.
 */
const listPlans = asyncHandler(async (req, res) => {
  const data = await planService.listForUser(req.user.userType);

  successResponse(res, httpStatus.OK, MESSAGES.PLAN.FETCHED, data);
});

/** Price a customer-chosen quantity without creating an order. */
const quoteCustom = asyncHandler(async (req, res) => {
  const quote = await planService.quoteCustom(req.body.quantities);

  successResponse(res, httpStatus.OK, MESSAGES.PLAN.QUOTE_FETCHED, quote);
});

module.exports = { listPlans, quoteCustom };
