const ApiError = require('../utils/apiError');
const { errorResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const env = require('../config/env');

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let statusCode = httpStatus.INTERNAL_SERVER_ERROR;
  let message = MESSAGES.SERVER.INTERNAL_ERROR;
  let errors = [];

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    errors = err.errors;
  } else if (err.name === 'ValidationError') {
    // Mongoose schema validation error
    statusCode = httpStatus.UNPROCESSABLE_ENTITY;
    message = MESSAGES.VALIDATION.FAILED;
    errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err.code === 11000) {
    // MongoDB duplicate key error (safety net behind service-level checks)
    statusCode = httpStatus.CONFLICT;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `This ${field} is already in use.`;
    errors = [{ field, message }];
  } else if (err.name === 'CastError') {
    statusCode = httpStatus.BAD_REQUEST;
    message = 'Invalid identifier provided.';
  }

  if (!env.isProduction && statusCode === httpStatus.INTERNAL_SERVER_ERROR) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  return errorResponse(res, statusCode, message, errors);
};

module.exports = errorHandler;
