const asyncHandler = require('../helpers/asyncHandler');
const { successResponse, errorResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const cdotWrapperService = require('../services/cdotWrapper.service');
const ApiError = require('../utils/apiError');

const checkImei = asyncHandler(async (req, res) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'API key is required in X-API-Key header.');
  }

  const result = await cdotWrapperService.checkImei({
    apiKey,
    imei: req.body.imei,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  successResponse(res, httpStatus.OK, 'IMEI checked successfully.', result);
});

module.exports = {
  checkImei,
};
