const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const diagnoseService = require('../services/diagnose.service');

const diagnose = asyncHandler(async (req, res) => {
  const result = await diagnoseService.runDiagnosis(req.user.id, req.body);

  successResponse(res, httpStatus.OK, MESSAGES.DIAGNOSE.COMPLETED, result);
});

module.exports = { diagnose };
