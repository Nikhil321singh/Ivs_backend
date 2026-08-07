const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin.model');
const WalletTransaction = require('../../models/WalletTransaction.model');
const ImeiVerificationLog = require('../../models/ImeiVerificationLog.model');
const User = require('../../models/User.model');
const { verifyPassword, hashPassword } = require('../utils/password.util');
const ApiError = require('../../utils/apiError');
const httpStatus = require('../../constants/httpStatus');
const MESSAGES = require('../../constants/messages');
const env = require('../../config/env');

// Distinguishes an admin token from a user token even when both are signed with
// the same secret — adminAuth requires this claim, and user tokens never carry it.
const ADMIN_TOKEN_TYPE = 'admin';

const generateAdminToken = (admin) =>
  jwt.sign({ sub: admin._id.toString(), typ: ADMIN_TOKEN_TYPE, email: admin.email }, env.adminJwt.secret, {
    expiresIn: env.adminJwt.expiry,
  });

const verifyAdminToken = (token) => {
  const decoded = jwt.verify(token, env.adminJwt.secret);

  if (decoded.typ !== ADMIN_TOKEN_TYPE) {
    throw new Error('Not an admin token');
  }

  return decoded;
};

const login = async (email, password) => {
  // passwordHash is select:false on the schema, so ask for it explicitly.
  const admin = await Admin.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');

  // Same error for "no such admin" and "wrong password" so the endpoint can't
  // be used to enumerate which admin emails exist.
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, MESSAGES.ADMIN.INVALID_CREDENTIALS);
  }

  if (!admin.isActive) {
    throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.ADMIN.ACCOUNT_DISABLED);
  }

  admin.lastLoginAt = new Date();
  await admin.save();

  return { admin, token: generateAdminToken(admin) };
};

const getAdminById = (id) => Admin.findById(id);

const createAdmin = async ({ email, password, name = null }) => {
  const passwordHash = await hashPassword(password);
  return Admin.create({ email: email.toLowerCase().trim(), passwordHash, name });
};

const paginate = ({ page = 1, limit = 20 }) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  return { safePage, safeLimit, skip: (safePage - 1) * safeLimit };
};

const buildPagination = (safePage, safeLimit, total) => ({
  page: safePage,
  limit: safeLimit,
  total,
  pages: Math.ceil(total / safeLimit) || 0,
});

/** Wallet ledger across all users, newest first. */
const listTransactions = async ({ page, limit, type = null, reason = null } = {}) => {
  const { safePage, safeLimit, skip } = paginate({ page, limit });

  const filter = {};
  if (type) filter.type = type;
  if (reason) filter.reason = reason;

  const [items, total] = await Promise.all([
    WalletTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('userId', 'name mobile countryCode')
      .lean(),
    WalletTransaction.countDocuments(filter),
  ]);

  return { items, pagination: buildPagination(safePage, safeLimit, total) };
};

/** IMEI verification audit log across all users, newest first. */
const listImeiChecks = async ({ page, limit, status = null } = {}) => {
  const { safePage, safeLimit, skip } = paginate({ page, limit });

  const filter = {};
  if (status) filter.imei1Status = status;

  const [items, total] = await Promise.all([
    ImeiVerificationLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('userId', 'name mobile countryCode')
      // rawResponse is bulky and only useful when debugging a single check.
      .select('-rawResponse')
      .lean(),
    ImeiVerificationLog.countDocuments(filter),
  ]);

  return { items, pagination: buildPagination(safePage, safeLimit, total) };
};

const getStats = async () => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [totalUsers, kycCompleted, totalChecks, checksToday, spentAgg] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ kycCompleted: true }),
    ImeiVerificationLog.countDocuments({}),
    ImeiVerificationLog.countDocuments({ createdAt: { $gte: since } }),
    WalletTransaction.aggregate([
      { $match: { type: 'DEBIT' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  return {
    totalUsers,
    kycCompleted,
    totalImeiChecks: totalChecks,
    imeiChecksToday: checksToday,
    tokensSpent: spentAgg[0]?.total || 0,
  };
};

module.exports = {
  login,
  getAdminById,
  createAdmin,
  verifyAdminToken,
  listTransactions,
  listImeiChecks,
  getStats,
};
