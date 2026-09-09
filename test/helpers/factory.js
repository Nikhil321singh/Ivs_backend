/**
 * Shared fixtures. Keeps the specs about behaviour rather than setup, and keeps
 * mobile numbers unique per call so a leftover row can never make one test
 * depend on another.
 */
const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User.model');
const Wallet = require('../../src/models/Wallet.model');
const Entitlement = require('../../src/models/Entitlement.model');
const Plan = require('../../src/models/Plan.model');
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

/**
 * A user holding credits, for the credit-pack billing path. Writes the counters
 * directly rather than going through a purchase — the purchase flow has its own
 * specs, and a fixture that depended on it would fail twice for one bug.
 */
const createCreditedUser = async (credits = { IVS_CHECK: 5, DIAGNOSE: 5 }, overrides = {}) => {
  const created = await createUser(overrides);
  await Entitlement.findOneAndUpdate(
    { userId: created.user._id },
    { userId: created.user._id, credits },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return created;
};

/** The three catalogue packs, priced so the ladder validates. */
const seedPlans = async () => {
  await Plan.create([
    {
      code: 'BASIC',
      name: 'Basic',
      tier: 'BASIC',
      quotas: { IVS_CHECK: 20, DIAGNOSE: 10 },
      pricePaise: 79900,
      sortOrder: 1,
    },
    {
      code: 'PRO',
      name: 'Pro',
      tier: 'PRO',
      quotas: { IVS_CHECK: 30, DIAGNOSE: 20 },
      pricePaise: 129900,
      badge: 'Most popular',
      highlight: true,
      sortOrder: 2,
    },
    {
      code: 'PRO_MAX',
      name: 'Pro Max',
      tier: 'PRO_MAX',
      quotas: { IVS_CHECK: 40, DIAGNOSE: 30 },
      pricePaise: 169900,
      sortOrder: 3,
    },
  ]);
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

const creditsOf = async (userId, feature) => {
  const entitlement = await Entitlement.findOne({ userId });
  return entitlement?.credits?.get(feature) ?? 0;
};

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
  createCreditedUser,
  seedPlans,
  createAdmin,
  asUser,
  balanceOf,
  creditsOf,
};
