const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const blanccoAdminService = require('../services/blanccoAdmin.service');

const listSessions = asyncHandler(async (req, res) => {
  const data = await blanccoAdminService.listSessions(req.query);

  successResponse(res, httpStatus.OK, MESSAGES.BLANCCO.SESSIONS_FETCHED, data);
});

const getSessionDetail = asyncHandler(async (req, res) => {
  const data = await blanccoAdminService.getSessionDetail(req.params.sessionId);

  successResponse(res, httpStatus.OK, MESSAGES.BLANCCO.SESSION_FETCHED, data);
});

const getStats = asyncHandler(async (req, res) => {
  const data = await blanccoAdminService.getStats();

  successResponse(res, httpStatus.OK, 'Blancco stats fetched.', data);
});

module.exports = { listSessions, getSessionDetail, getStats };
