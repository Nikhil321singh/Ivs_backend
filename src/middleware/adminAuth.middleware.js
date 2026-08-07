const asyncHandler = require('../helpers/asyncHandler');
const adminService = require('../services/admin.service');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/**
 * Gate for /admin routes. Requires a token carrying `typ: "admin"` (which user
 * tokens never have) AND an Admin row that still exists and is active — so
 * deactivating an admin revokes access on the next request rather than when the
 * token happens to expire.
 */
const adminAuth = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.ADMIN.TOKEN_MISSING);
  }

  let decoded;
  try {
    decoded = adminService.verifyAdminToken(authHeader.split(' ')[1]);
  } catch {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.ADMIN.TOKEN_INVALID);
  }

  const admin = await adminService.getAdminById(decoded.sub);

  if (!admin) {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.ADMIN.TOKEN_INVALID);
  }

  if (!admin.isActive) {
    throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.ADMIN.ACCOUNT_DISABLED);
  }

  req.admin = admin;
  next();
});

module.exports = adminAuth;
