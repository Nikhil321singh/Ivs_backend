const { validationResult } = require('express-validator');
const { errorResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map((err) => ({
      field: err.path,
      message: err.msg,
    }));

    return errorResponse(res, httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.VALIDATION.FAILED, formattedErrors);
  }

  next();
};

module.exports = validateRequest;
