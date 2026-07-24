const jwt = require('jsonwebtoken');
const RefreshToken = require('../models/RefreshToken.model');
const User = require('../models/User.model');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt.util');
const { hashToken } = require('../utils/hash.util');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const USER_STATUS = require('../constants/userStatus');

/**
 * Issues a new access/refresh token pair for a user+device and persists the
 * refresh token (hashed) in the RefreshToken collection. Upserting on
 * {userId, deviceId} means re-authenticating on the same device rotates the
 * previous session rather than accumulating stale documents.
 */
const issueTokenPair = async (user, deviceId) => {
  const userId = user._id.toString();

  const accessToken = generateAccessToken({ sub: userId });
  const refreshToken = generateRefreshToken({ sub: userId, deviceId });

  const decoded = jwt.decode(refreshToken);
  const expiresAt = new Date(decoded.exp * 1000);

  await RefreshToken.findOneAndUpdate(
    { userId, deviceId },
    {
      userId,
      deviceId,
      refreshToken: hashToken(refreshToken),
      expiresAt,
      isRevoked: false,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { accessToken, refreshToken };
};

/**
 * Validates a refresh token against its stored hash for the given device,
 * then rotates it (issues a fresh access + refresh token pair).
 */
const rotateRefreshToken = async (refreshTokenPlain, deviceId) => {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshTokenPlain);
  } catch (error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.AUTH.REFRESH_TOKEN_INVALID);
  }

  if (decoded.deviceId !== deviceId) {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.AUTH.REFRESH_TOKEN_INVALID);
  }

  const tokenDoc = await RefreshToken.findOne({ userId: decoded.sub, deviceId });

  if (!tokenDoc) {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.AUTH.REFRESH_TOKEN_INVALID);
  }

  if (tokenDoc.isRevoked) {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.AUTH.REFRESH_TOKEN_REVOKED);
  }

  if (tokenDoc.expiresAt.getTime() < Date.now()) {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.AUTH.REFRESH_TOKEN_INVALID);
  }

  if (hashToken(refreshTokenPlain) !== tokenDoc.refreshToken) {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.AUTH.REFRESH_TOKEN_INVALID);
  }

  const user = await User.findById(decoded.sub);

  if (!user) {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.AUTH.USER_NOT_FOUND);
  }

  if (user.status === USER_STATUS.BLOCKED) {
    throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.AUTH.USER_BLOCKED);
  }

  const tokens = await issueTokenPair(user, deviceId);

  return { user, ...tokens };
};

/**
 * Revokes the session for a given user+device (logout). Idempotent — a
 * missing document is not an error.
 */
const revokeRefreshToken = async (userId, deviceId) => {
  await RefreshToken.findOneAndUpdate({ userId, deviceId }, { isRevoked: true });
};

module.exports = { issueTokenPair, rotateRefreshToken, revokeRefreshToken };
