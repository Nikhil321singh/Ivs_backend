const successResponse = (res, statusCode, message, data = {}) =>
  res.status(statusCode).json({
    success: true,
    message,
    data,
  });

const errorResponse = (res, statusCode, message, errors = []) =>
  res.status(statusCode).json({
    success: false,
    message,
    errors,
  });

module.exports = { successResponse, errorResponse };
