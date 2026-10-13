const jwt = require('jsonwebtoken');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const env = require('../config/env');

const vendorAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'No token provided. Use Bearer token in Authorization header.');
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, env.jwt.accessSecret);

    if (decoded.type !== 'vendor') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Admin token not allowed for vendor routes.');
    }

    req.vendor = {
      id: decoded.vendorId,
      email: decoded.email,
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Token has expired.');
    }
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid token.');
  }
};

module.exports = vendorAuth;
