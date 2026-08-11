/**
 * Shared fixtures. Keeps the specs about behaviour rather than setup, and keeps
 * mobile numbers unique per call so a leftover row can never make one test
 * depend on another.
 */
const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User.model');
const Wallet = require('../../src/models/Wallet.model');
const Admin = require('../../src/admin/models/Admin.model');
const { generateAccessToken } = require('../../src/utils/jwt.util');
const { hashPassword } = require('../../src/admin/utils/password.util');

let counter = 0;
const uniqueMobile = () => {
  counter += 1;
  return `9${String(100000000 + counter).slice(0, 9)}`;
};

/** A signed-in user. Pass overrides for KYC state, type, etc. */
const createUser = async (overrides = {}) => {
  const user = await User.create({
    mobile: overrides.mobile || uniqueMobile(),
    countryCode: '+91',
    isMobileVerified: true,
    ...overrides,
  });

  return { user, token: generateAccessToken({ sub: user._id.toString() }) };
};

/** A user with tokens to spend on paid features. */
const createFundedUser = async (balance = 500, overrides = {}) => {
  const created = await createUser(overrides);
  await Wallet.findOneAndUpdate(
    { userId: created.user._id },
    { userId: created.user._id, balance },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return created;
};

const createAdmin = async (password = 'admin-test-password') => {
  const admin = await Admin.create({
    email: `admin${(counter += 1)}@test.local`,
    passwordHash: await hashPassword(password),
    name: 'Test Admin',
  });

  const res = await request(app)
    .post('/api/v1/admin/login')
    .send({ email: admin.email, password });

  return { admin, password, token: res.body.data.token };
};

/** supertest request with a user bearer token already attached. */
const asUser = (token) => ({
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${token}`),
  post: (path) => request(app).post(path).set('Authorization', `Bearer ${token}`),
  put: (path) => request(app).put(path).set('Authorization', `Bearer ${token}`),
  patch: (path) => request(app).patch(path).set('Authorization', `Bearer ${token}`),
  delete: (path) => request(app).delete(path).set('Authorization', `Bearer ${token}`),
});

const balanceOf = async (userId) => {
  const wallet = await Wallet.findOne({ userId });
  return wallet ? wallet.balance : 0;
};

module.exports = {
  app,
  request,
  uniqueMobile,
  createUser,
  createFundedUser,
  createAdmin,
  asUser,
  balanceOf,
};
