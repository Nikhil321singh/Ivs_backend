const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const CDOTVendor = require('../models/CDOTVendor.model');
const CDOTAPIKey = require('../models/CDOTAPIKey.model');
const CDOTCallLog = require('../models/CDOTCallLog.model');
const CDOTTransaction = require('../models/CDOTTransaction.model');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const env = require('../config/env');

const CDOT_COST_PAISE = 1900; // ₹19

const register = async ({ email, password, companyName }) => {
  const existing = await CDOTVendor.findOne({ email });
  if (existing) {
    throw new ApiError(httpStatus.CONFLICT, 'Email already registered.');
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const vendor = await CDOTVendor.create({
    email,
    password: hashedPassword,
    companyName,
    walletBalance: 0,
  });

  const apiKey = await CDOTAPIKey.create({
    vendorId: vendor._id,
  });

  const token = jwt.sign(
    { vendorId: vendor._id, email: vendor.email, type: 'vendor' },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessExpiry }
  );

  return {
    vendor: {
      id: vendor._id,
      email: vendor.email,
      companyName: vendor.companyName,
    },
    apiKey: apiKey.key,
    token,
  };
};

const login = async ({ email, password }) => {
  const vendor = await CDOTVendor.findOne({ email });
  if (!vendor) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid email or password.');
  }

  const isPasswordValid = await bcrypt.compare(password, vendor.password);
  if (!isPasswordValid) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid email or password.');
  }

  if (!vendor.isActive) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Your account is disabled.');
  }

  const apiKey = await CDOTAPIKey.findOne({ vendorId: vendor._id, isActive: true });
  if (!apiKey) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'API key not found.');
  }

  const token = jwt.sign(
    { vendorId: vendor._id, email: vendor.email, type: 'vendor' },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessExpiry }
  );

  return {
    vendor: {
      id: vendor._id,
      email: vendor.email,
      companyName: vendor.companyName,
      walletBalance: vendor.walletBalance,
    },
    apiKey: apiKey.key,
    token,
  };
};

const changePassword = async (vendorId, { currentPassword, newPassword }) => {
  const vendor = await CDOTVendor.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor not found.');
  }

  const isPasswordValid = await bcrypt.compare(currentPassword, vendor.password);
  if (!isPasswordValid) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Current password is incorrect.');
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await CDOTVendor.findByIdAndUpdate(vendorId, { password: hashedPassword });

  return { success: true, message: 'Password changed successfully.' };
};

const getDashboard = async (vendorId) => {
  const vendor = await CDOTVendor.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor not found.');
  }

  const checksRemaining = Math.floor(vendor.walletBalance / CDOT_COST_PAISE);

  return {
    vendor: {
      id: vendor._id,
      companyName: vendor.companyName,
      email: vendor.email,
    },
    wallet: {
      balance: vendor.walletBalance,
      checksRemaining,
    },
    stats: {
      totalCalls: vendor.totalApiCalls,
      totalSpent: vendor.totalSpent,
    },
  };
};

const getApiCalls = async (vendorId, { page = 1, limit = 20 }) => {
  const skip = (page - 1) * limit;

  const calls = await CDOTCallLog.find({ vendorId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await CDOTCallLog.countDocuments({ vendorId });

  return {
    calls: calls.map((call) => ({
      id: call._id,
      imei: call.imei,
      status: call.result?.imeiStatus,
      cost: call.costPaise,
      date: call.createdAt,
    })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

const getTransactions = async (vendorId, { page = 1, limit = 20 }) => {
  const skip = (page - 1) * limit;

  const transactions = await CDOTTransaction.find({ vendorId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await CDOTTransaction.countDocuments({ vendorId });

  return {
    transactions: transactions.map((txn) => ({
      id: txn._id,
      type: txn.type,
      amount: txn.amountPaise,
      reason: txn.reason,
      balanceBefore: txn.balanceBefore,
      balanceAfter: txn.balanceAfter,
      date: txn.createdAt,
    })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

const getApiKey = async (vendorId) => {
  const apiKey = await CDOTAPIKey.findOne({ vendorId, isActive: true });
  if (!apiKey) {
    throw new ApiError(httpStatus.NOT_FOUND, 'API key not found.');
  }

  return {
    key: apiKey.key,
    createdAt: apiKey.createdAt,
    lastUsedAt: apiKey.lastUsedAt,
    isActive: apiKey.isActive,
  };
};

const regenerateApiKey = async (vendorId) => {
  const oldKey = await CDOTAPIKey.findOne({ vendorId, isActive: true });
  if (oldKey) {
    await CDOTAPIKey.findByIdAndUpdate(oldKey._id, { isActive: false });
  }

  const newKey = await CDOTAPIKey.create({
    vendorId,
  });

  return {
    key: newKey.key,
    message: 'API key regenerated successfully. Old key is now inactive.',
  };
};

module.exports = {
  register,
  login,
  changePassword,
  getDashboard,
  getApiCalls,
  getTransactions,
  getApiKey,
  regenerateApiKey,
};
