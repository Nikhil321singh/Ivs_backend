const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const entitlementService = require('../services/entitlement.service');

const getEntitlement = asyncHandler(async (req, res) => {
  const data = await entitlementService.getSummary(req.user.id);

  successResponse(res, httpStatus.OK, MESSAGES.ENTITLEMENT.FETCHED, data);
});

const getTransactions = asyncHandler(async (req, res) => {
  const data = await entitlementService.getLedger(req.user.id, {
    page: req.query.page,
    limit: req.query.limit,
    feature: req.query.feature,
  });

  successResponse(res, httpStatus.OK, MESSAGES.ENTITLEMENT.TRANSACTIONS_FETCHED, data);
});

module.exports = { getEntitlement, getTransactions };
