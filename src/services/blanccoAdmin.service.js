const mongoose = require('mongoose');
const BlanccoSession = require('../models/BlanccoSession.model');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

const { SESSION_STATUS } = BlanccoSession;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const serializeSession = (s) => {
  const user = s.userId && typeof s.userId === 'object' ? s.userId : null;
  return {
    id: String(s._id),
    userId: String(user ? user._id : s.userId),
    sessionToken: s.sessionToken,
    customerName: s.customerName,
    customerPhone: s.customerPhone,
    customerEmail: s.customerEmail || null,
    aadhaarNumber: s.customerAadhaarNumber || null,
    imei: s.imei || null,
    deviceModel: s.deviceModel || null,
    deviceBrand: s.deviceBrand || null,
    price: s.price,
    status: s.status,
    scannedAt: s.scannedAt || null,
    createdAt: s.createdAt,
    vendorName: user ? user.name : null,
    vendorMobile: user ? user.mobile : null,
  };
};

const listSessions = async ({ page = 1, limit = 20, search, status, userId } = {}) => {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const filter = {};
  if (status) filter.status = status;
  if (userId) {
    if (!mongoose.isValidObjectId(userId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID.');
    }
    filter.userId = new mongoose.Types.ObjectId(userId);
  }

  if (search && String(search).trim()) {
    const rx = new RegExp(escapeRegex(String(search).trim()), 'i');
    filter.$or = [
      { customerName: rx },
      { customerPhone: rx },
      { customerEmail: rx },
      { imei: rx },
      { deviceModel: rx },
      { deviceBrand: rx },
      { sessionToken: rx },
    ];
  }

  const [sessions, total] = await Promise.all([
    BlanccoSession.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('userId', 'name mobile')
      .lean(),
    BlanccoSession.countDocuments(filter),
  ]);

  return {
    items: sessions.map(serializeSession),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit) || 0,
    },
  };
};

const getSessionDetail = async (sessionId) => {
  if (!mongoose.isValidObjectId(sessionId)) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.BLANCCO.SESSION_NOT_FOUND);
  }

  const session = await BlanccoSession.findById(sessionId)
    .populate('userId', 'name mobile email companyName')
    .lean();

  if (!session) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.BLANCCO.SESSION_NOT_FOUND);
  }

  const user = session.userId && typeof session.userId === 'object' ? session.userId : null;

  return {
    ...serializeSession(session),
    vendor: user
      ? {
          id: String(user._id),
          name: user.name,
          mobile: user.mobile,
          email: user.email || null,
          companyName: user.companyName || null,
        }
      : null,
  };
};

const getStats = async () => {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [total, pending, scanned, completed, expired, today] = await Promise.all([
    BlanccoSession.countDocuments(),
    BlanccoSession.countDocuments({ status: SESSION_STATUS.PENDING }),
    BlanccoSession.countDocuments({ status: SESSION_STATUS.SCANNED }),
    BlanccoSession.countDocuments({ status: SESSION_STATUS.COMPLETED }),
    BlanccoSession.countDocuments({ status: SESSION_STATUS.EXPIRED }),
    BlanccoSession.countDocuments({ createdAt: { $gte: since24h } }),
  ]);

  return {
    total,
    pending,
    scanned,
    completed,
    expired,
    today,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
};

module.exports = { listSessions, getSessionDetail, getStats };
