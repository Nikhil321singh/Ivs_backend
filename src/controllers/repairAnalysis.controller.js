const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const repairAnalysisService = require('../services/repairAnalysis.service');

const analyzeFault = asyncHandler(async (req, res) => {
  const { query } = req.body;

  const result = await repairAnalysisService.analyzeFault(query);

  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  successResponse(res, httpStatus.OK, 'Device fault analysis completed', result);
});

const chatRepair = asyncHandler(async (req, res) => {
  const { message, context } = req.body;

  const result = await repairAnalysisService.chatRepair(message, context);

  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  successResponse(res, httpStatus.OK, 'Chat response received', result);
});

module.exports = {
  analyzeFault,
  chatRepair,
};
