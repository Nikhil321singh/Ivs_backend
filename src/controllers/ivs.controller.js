const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const ivsService = require('../services/ivs.service');

const verifyImei = asyncHandler(async (req, res) => {
  const result = await ivsService.verifyImei(req.user.id, req.body);

  successResponse(res, httpStatus.OK, MESSAGES.IVS.VERIFIED, result);
});

module.exports = { verifyImei };
