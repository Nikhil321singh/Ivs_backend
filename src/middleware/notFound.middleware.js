const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

const notFoundHandler = (req, res, next) => {
  next(new ApiError(httpStatus.NOT_FOUND, MESSAGES.SERVER.ROUTE_NOT_FOUND));
};

module.exports = notFoundHandler;
