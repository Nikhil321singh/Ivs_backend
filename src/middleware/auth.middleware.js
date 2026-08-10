const jwt = require('jsonwebtoken');
const asyncHandler = require('../helpers/asyncHandler');
const { verifyAccessToken } = require('../utils/jwt.util');
const userService = require('../services/user.service');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const USER_STATUS = require('../constants/userStatus');

const authenticate = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.AUTH.ACCESS_TOKEN_MISSING);
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.AUTH.ACCESS_TOKEN_EXPIRED);
    }
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.AUTH.ACCESS_TOKEN_INVALID);
  }

  const user = await userService.getUserById(decoded.sub);

  if (user.status === USER_STATUS.BLOCKED) {
    throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.AUTH.USER_BLOCKED);
  }

  // A deleted account keeps its row (financial records reference it), so it
  // must be rejected explicitly — otherwise an access token issued before
  // deletion would keep working until it expired, up to an hour later.
  if (user.status === USER_STATUS.DELETED) {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.USER.ACCOUNT_ALREADY_DELETED);
  }

  req.user = user;
  next();
});

module.exports = authenticate;
