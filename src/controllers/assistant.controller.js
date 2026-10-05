const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const assistantService = require('../services/assistant.service');

const chat = asyncHandler(async (req, res) => {
  const result = await assistantService.chat(req.body.messages);

  successResponse(res, httpStatus.OK, 'Assistant replied.', result);
});

module.exports = { chat };
