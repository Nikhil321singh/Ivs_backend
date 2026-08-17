const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin.model');
const WalletTransaction = require('../../models/WalletTransaction.model');
const ImeiVerificationLog = require('../../models/ImeiVerificationLog.model');
const Payment = require('../../models/Payment.model');
const User = require('../../models/User.model');
const userService = require('../../services/user.service');
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

// Escaped so a search term containing regex metacharacters (a '+' in a phone
// number is the common one) matches literally instead of erroring or matching
// something unintended.
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The user directory behind the admin console's Users screen.
 *
 * `search` matches across every identifier an operator is realistically
 * holding when they go looking for someone — mobile, name, company, email,
 * PAN, GST or referral code. Each row carries its wallet balance (one $lookup
 * rather than a query per row) so the list is useful without drilling in.
 *
 * aadhaarNumberHash and profileImagePublicId are projected away: they are
 * internal and the model's toJSON transform, which normally strips them, does
 * not run on aggregate output.
 */
const listUsers = async ({ page, limit, search, kycCompleted, userType, status } = {}) => {
  const { safePage, safeLimit, skip } = paginate({ page, limit });

  const filter = {};
  if (userType) filter.userType = userType;
  if (status) filter.status = status;
  if (kycCompleted !== undefined && kycCompleted !== '') {
    filter.kycCompleted = kycCompleted === 'true' || kycCompleted === true;
  }

  if (search && String(search).trim()) {
    const rx = new RegExp(escapeRegex(String(search).trim()), 'i');
    filter.$or = [
      { mobile: rx },
      { name: rx },
      { companyName: rx },
      { email: rx },
      { panNumber: rx },
      { gstNumber: rx },
      { referralCode: rx },
    ];
  }

  const [items, total] = await Promise.all([
    User.aggregate([
      { $match: filter },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: safeLimit },
      {
        $lookup: {
          from: 'wallets',
          localField: '_id',
          foreignField: 'userId',
          as: 'walletDoc',
        },
      },
      {
        $addFields: {
          id: '$_id',
          balance: { $ifNull: [{ $arrayElemAt: ['$walletDoc.balance', 0] }, 0] },
        },
      },
      { $project: { _id: 0, __v: 0, walletDoc: 0, aadhaarNumberHash: 0, profileImagePublicId: 0 } },
    ]),
    User.countDocuments(filter),
  ]);

  return { items, pagination: buildPagination(safePage, safeLimit, total) };
};

// How many recent rows of each kind ride along with a user detail view. Enough
// to see what someone has been doing without turning one screen into an
// unbounded export — the paginated /admin/imei-checks and /admin/transactions
// endpoints are there for the full history.
const RECENT_LIMIT = 20;

/**
 * One user, in full: the same profile/KYC/wallet/referral/activity payload the
 * user themselves gets from /user/me, plus the recent rows an operator needs
 * when answering "what happened on this account?" — IMEI checks, ledger
 * movements and top-ups.
 *
 * Throws 404 through userService.getUserDetails when no such user exists.
 */
// .lean() skips each model's toJSON transform, so these rows would otherwise
// come back with _id/__v while every other payload in the API exposes `id`.
// Normalising here keeps one identifier convention across the whole surface.
const withId = (rows) =>
  rows.map(({ _id, __v, ...rest }) => ({ id: String(_id), ...rest }));

const getUserDetail = async (userId) => {
  const details = await userService.getUserDetails(userId);

  const [imeiChecks, transactions, payments] = await Promise.all([
    ImeiVerificationLog.find({ userId })
      .sort({ createdAt: -1 })
      .limit(RECENT_LIMIT)
      // rawResponse is bulky and only useful when debugging a single check.
      .select('-rawResponse')
      .lean(),
    WalletTransaction.find({ userId }).sort({ createdAt: -1 }).limit(RECENT_LIMIT).lean(),
    Payment.find({ userId }).sort({ createdAt: -1 }).limit(RECENT_LIMIT).lean(),
  ]);

  return {
    ...details,
    recent: {
      imeiChecks: withId(imeiChecks),
      transactions: withId(transactions),
      payments: withId(payments),
    },
  };
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
  listUsers,
  getUserDetail,
  getStats,
};
