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

  req.user = user;
  next();
});

module.exports = authenticate;
