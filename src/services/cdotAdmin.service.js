const CDOTVendor = require('../models/CDOTVendor.model');
const CDOTAPIKey = require('../models/CDOTAPIKey.model');
const CDOTCallLog = require('../models/CDOTCallLog.model');
const CDOTTransaction = require('../models/CDOTTransaction.model');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');

const createVendor = async ({ email, companyName, initialWalletBalance = 0 }) => {
  const existing = await CDOTVendor.findOne({ email });
  if (existing) {
    throw new ApiError(httpStatus.CONFLICT, 'Vendor email already exists.');
  }

  const tempPassword = Math.random().toString(36).substring(2, 10).toUpperCase();

  const vendor = await CDOTVendor.create({
    email,
    password: tempPassword,
    companyName,
    walletBalance: initialWalletBalance,
  });

  const apiKey = await CDOTAPIKey.create({
    vendorId: vendor._id,
  });

  return {
    vendor: {
      id: vendor._id,
      email: vendor.email,
      companyName: vendor.companyName,
      walletBalance: vendor.walletBalance,
    },
    apiKey: apiKey.key,
    tempPassword,
    message: 'Share API key and temp password with vendor. Vendor must change password on first login.',
  };
};

const listVendors = async ({ page = 1, limit = 20, search, isActive }) => {
  const skip = (page - 1) * limit;
  const query = {};

  if (search) {
    query.$or = [
      { email: { $regex: search, $options: 'i' } },
      { companyName: { $regex: search, $options: 'i' } },
    ];
  }

  if (isActive !== undefined) {
    query.isActive = isActive;
  }

  const vendors = await CDOTVendor.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await CDOTVendor.countDocuments(query);

  return {
    vendors: vendors.map((v) => ({
      id: v._id,
      email: v.email,
      companyName: v.companyName,
      walletBalance: v.walletBalance,
      totalCalls: v.totalApiCalls,
      totalSpent: v.totalSpent,
      isActive: v.isActive,
      lastActivity: v.lastActivityAt,
      createdAt: v.createdAt,
    })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

const getVendorDetail = async (vendorId) => {
  const vendor = await CDOTVendor.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor not found.');
  }

  const apiKey = await CDOTAPIKey.findOne({ vendorId, isActive: true });
  const recentCalls = await CDOTCallLog.find({ vendorId }).sort({ createdAt: -1 }).limit(10);
  const recentTransactions = await CDOTTransaction.find({ vendorId })
    .sort({ createdAt: -1 })
    .limit(10);

  const checksRemaining = Math.floor(vendor.walletBalance / 1900);

  return {
    vendor: {
      id: vendor._id,
      email: vendor.email,
      companyName: vendor.companyName,
      isActive: vendor.isActive,
      createdAt: vendor.createdAt,
    },
    wallet: {
      balance: vendor.walletBalance,
      checksRemaining,
      totalSpent: vendor.totalSpent,
    },
    stats: {
      totalApiCalls: vendor.totalApiCalls,
      lastActivity: vendor.lastActivityAt,
    },
    apiKey: {
      key: apiKey?.key || null,
      createdAt: apiKey?.createdAt || null,
      lastUsed: apiKey?.lastUsedAt || null,
      isActive: apiKey?.isActive || false,
    },
    recentCalls: recentCalls.map((c) => ({
      id: c._id,
      imei: c.imei,
      status: c.result?.imeiStatus,
      cost: c.costPaise,
      date: c.createdAt,
    })),
    recentTransactions: recentTransactions.map((t) => ({
      id: t._id,
      type: t.type,
      amount: t.amountPaise,
      reason: t.reason,
      date: t.createdAt,
    })),
  };
};

const adjustWallet = async (vendorId, { amount, reason }) => {
  const vendor = await CDOTVendor.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor not found.');
  }

  const balanceBefore = vendor.walletBalance;
  const balanceAfter = balanceBefore + amount;

  if (balanceAfter < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Adjustment would result in negative balance.');
  }

  await CDOTTransaction.create({
    vendorId,
    type: amount > 0 ? 'CREDIT' : 'DEBIT',
    amountPaise: Math.abs(amount),
    reason: 'ADMIN_ADJUSTMENT',
    balanceBefore,
    balanceAfter,
    reference: reason,
  });

  const updated = await CDOTVendor.findByIdAndUpdate(
    vendorId,
    { walletBalance: balanceAfter },
    { new: true }
  );

  return {
    vendor: {
      id: updated._id,
      email: updated.email,
      companyName: updated.companyName,
      walletBalance: updated.walletBalance,
    },
    adjustment: {
      amount,
      balanceBefore,
      balanceAfter,
      reason,
    },
  };
};

const suspendVendor = async (vendorId) => {
  const vendor = await CDOTVendor.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor not found.');
  }

  await CDOTVendor.findByIdAndUpdate(vendorId, { isActive: false });
  await CDOTAPIKey.updateMany({ vendorId }, { isActive: false });

  return { message: 'Vendor suspended. All API keys deactivated.' };
};

const unsuspendVendor = async (vendorId) => {
  const vendor = await CDOTVendor.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor not found.');
  }

  await CDOTVendor.findByIdAndUpdate(vendorId, { isActive: true });

  const apiKey = await CDOTAPIKey.findOne({ vendorId });
  if (apiKey && !apiKey.isActive) {
    await CDOTAPIKey.findByIdAndUpdate(apiKey._id, { isActive: true });
  }

  return { message: 'Vendor reactivated. API key restored.' };
};

const getAnalytics = async () => {
  const totalVendors = await CDOTVendor.countDocuments();
  const activeVendors = await CDOTVendor.countDocuments({ isActive: true });
  const totalApiCalls = await CDOTCallLog.countDocuments();
  const totalRevenue = await CDOTCallLog.aggregate([
    { $group: { _id: null, total: { $sum: '$costPaise' } } },
  ]);

  const topVendors = await CDOTVendor.find()
    .sort({ totalApiCalls: -1 })
    .limit(5)
    .select('companyName totalApiCalls totalSpent walletBalance');

  const dailyRevenue = await CDOTCallLog.aggregate([
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        calls: { $sum: 1 },
        revenue: { $sum: '$costPaise' },
      },
    },
    { $sort: { _id: -1 } },
    { $limit: 30 },
  ]);

  return {
    overview: {
      totalVendors,
      activeVendors,
      inactiveVendors: totalVendors - activeVendors,
      totalApiCalls,
      totalRevenue: totalRevenue[0]?.total || 0,
      avgCallsPerVendor: totalVendors > 0 ? Math.round(totalApiCalls / totalVendors) : 0,
    },
    topVendors: topVendors.map((v) => ({
      id: v._id,
      companyName: v.companyName,
      totalCalls: v.totalApiCalls,
      totalSpent: v.totalSpent,
      walletBalance: v.walletBalance,
    })),
    dailyRevenue: dailyRevenue.map((d) => ({
      date: d._id,
      calls: d.calls,
      revenue: d.revenue,
    })),
  };
};

const exportVendorData = async (vendorId, format = 'json') => {
  const vendor = await CDOTVendor.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor not found.');
  }

  const calls = await CDOTCallLog.find({ vendorId }).sort({ createdAt: -1 });
  const transactions = await CDOTTransaction.find({ vendorId }).sort({ createdAt: -1 });

  if (format === 'csv') {
    const callsCsv = [
      'IMEI,Status,Cost (₹),Date',
      ...calls.map((c) => `${c.imei},${c.result?.imeiStatus},${(c.costPaise / 100).toFixed(2)},${c.createdAt.toISOString()}`),
    ].join('\n');

    const txnCsv = [
      'Type,Amount (₹),Reason,Date',
      ...transactions.map((t) => `${t.type},${(t.amountPaise / 100).toFixed(2)},${t.reason},${t.createdAt.toISOString()}`),
    ].join('\n');

    return { calls: callsCsv, transactions: txnCsv, format: 'csv' };
  }

  return {
    vendor: {
      id: vendor._id,
      email: vendor.email,
      companyName: vendor.companyName,
    },
    calls,
    transactions,
    format: 'json',
  };
};

module.exports = {
  createVendor,
  listVendors,
  getVendorDetail,
  adjustWallet,
  suspendVendor,
  unsuspendVendor,
  getAnalytics,
  exportVendorData,
};
