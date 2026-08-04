const User = require('../../src/models/User.model');
const { generateAccessToken } = require('../../src/utils/jwt.util');

/**
 * Creates a persisted user and returns it alongside a valid Bearer token, so
 * tests can hit authenticated routes exactly as a real client would (the auth
 * middleware re-loads the user from the DB by the token's `sub`).
 */
const createUserWithToken = async (overrides = {}) => {
  const user = await User.create({
    countryCode: '+91',
    mobile: `9${Math.floor(100000000 + Math.random() * 899999999)}`,
    isMobileVerified: true,
    ...overrides,
  });

  const token = generateAccessToken({ sub: user._id.toString() });
  return { user, token, authHeader: `Bearer ${token}` };
};

module.exports = { createUserWithToken };
