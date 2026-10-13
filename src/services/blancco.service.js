const crypto = require('crypto');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const BlanccoSession = require('../models/BlanccoSession.model');
const blanccoProvider = require('./providers/blanccoProvider');
const { maskAadhaar } = require('../utils/mask.util');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

const { SESSION_STATUS } = BlanccoSession;

const QR_EXPIRY_HOURS = 24;

const generateSessionToken = () =>
  `BLC-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;

const serializeSession = (s) => ({
  id: String(s._id),
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
  qrData: s.qrData,
  expiresAt: s.expiresAt,
  scannedAt: s.scannedAt || null,
  createdAt: s.createdAt,
});

const createSession = async (userId, payload) => {
  const {
    customerName,
    customerPhone,
    customerEmail,
    aadhaarNumber,
    imei,
    deviceModel,
    deviceBrand,
    price,
  } = payload;

  const sessionToken = generateSessionToken();
  const qrData = blanccoProvider.buildScanUrl(sessionToken);
  const expiresAt = new Date(Date.now() + QR_EXPIRY_HOURS * 60 * 60 * 1000);

  const qrImage = await QRCode.toDataURL(qrData, {
    errorCorrectionLevel: 'M',
    width: 400,
    margin: 2,
  });

  const session = await BlanccoSession.create({
    userId,
    sessionToken,
    customerName,
    customerPhone,
    customerEmail: customerEmail || null,
    customerAadhaarNumber: aadhaarNumber ? maskAadhaar(aadhaarNumber) : null,
    imei: imei || null,
    deviceModel: deviceModel || null,
    deviceBrand: deviceBrand || null,
    price,
    status: SESSION_STATUS.PENDING,
    qrData,
    expiresAt,
  });

  return {
    ...serializeSession(session.toObject()),
    qrImage,
  };
};

/**
 * One-time scan. The customer's phone hits this via the QR code URL.
 * Returns the Blancco redirect URL on first scan; rejects every subsequent
 * attempt so the same QR cannot be reused.
 */
const scanSession = async (sessionToken) => {
  const session = await BlanccoSession.findOne({ sessionToken });

  if (!session) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.BLANCCO.SESSION_NOT_FOUND);
  }

  if (session.status === SESSION_STATUS.EXPIRED || session.expiresAt < new Date()) {
    if (session.status !== SESSION_STATUS.EXPIRED) {
      await BlanccoSession.updateOne(
        { _id: session._id },
        { $set: { status: SESSION_STATUS.EXPIRED } }
      );
    }
    throw new ApiError(httpStatus.GONE, MESSAGES.BLANCCO.SESSION_EXPIRED);
  }

  if (session.status !== SESSION_STATUS.PENDING) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.BLANCCO.QR_ALREADY_USED);
  }

  await BlanccoSession.updateOne(
    { _id: session._id },
    { $set: { status: SESSION_STATUS.SCANNED, scannedAt: new Date() } }
  );

  return { redirectUrl: blanccoProvider.blanccoRedirectUrl() };
};

const getSessionById = async (userId, sessionId) => {
  if (!mongoose.isValidObjectId(sessionId)) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.BLANCCO.SESSION_NOT_FOUND);
  }

  const session = await BlanccoSession.findOne({ _id: sessionId, userId }).lean();
  if (!session) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.BLANCCO.SESSION_NOT_FOUND);
  }

  return serializeSession(session);
};

const getReport = async (userId, sessionId) => {
  if (!mongoose.isValidObjectId(sessionId)) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.BLANCCO.SESSION_NOT_FOUND);
  }

  const session = await BlanccoSession.findOne({ _id: sessionId, userId }).lean();
  if (!session) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.BLANCCO.SESSION_NOT_FOUND);
  }

  if (session.status === SESSION_STATUS.EXPIRED) {
    throw new ApiError(httpStatus.GONE, MESSAGES.BLANCCO.SESSION_EXPIRED);
  }

  if (session.status === SESSION_STATUS.PENDING) {
    return {
      session: serializeSession(session),
      diagnoseCompleted: false,
      report: null,
      message: MESSAGES.BLANCCO.QR_NOT_SCANNED,
    };
  }

  const statusCheck = await blanccoProvider.checkStatus(session.sessionToken);

  if (!statusCheck.completed) {
    return {
      session: serializeSession(session),
      diagnoseCompleted: false,
      report: null,
    };
  }

  const reportResult = await blanccoProvider.getReport(session.sessionToken);

  if (!reportResult.success) {
    throw new ApiError(httpStatus.BAD_GATEWAY, MESSAGES.BLANCCO.REPORT_FETCH_FAILED);
  }

  if (session.status !== SESSION_STATUS.COMPLETED) {
    await BlanccoSession.updateOne(
      { _id: session._id },
      { $set: { status: SESSION_STATUS.COMPLETED } }
    );
  }

  return {
    session: serializeSession({ ...session, status: SESSION_STATUS.COMPLETED }),
    diagnoseCompleted: true,
    report: reportResult.report,
  };
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildSearchFilter = (search) => {
  const q = String(search || '').trim();
  if (!q) return null;

  const rx = new RegExp(escapeRegex(q), 'i');
  return {
    $or: [
      { customerName: rx },
      { customerPhone: rx },
      { customerEmail: rx },
      { imei: rx },
      { deviceModel: rx },
      { deviceBrand: rx },
    ],
  };
};

const getSessions = async (userId, { page = 1, limit = 20, search } = {}) => {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const searchFilter = buildSearchFilter(search);
  const filter = searchFilter ? { userId, ...searchFilter } : { userId };

  const [sessions, total] = await Promise.all([
    BlanccoSession.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
    BlanccoSession.countDocuments(filter),
  ]);

  return {
    items: sessions.map(serializeSession),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
};

const getStats = async (userId) => {
  const [total, pending, scanned, completed, expired] = await Promise.all([
    BlanccoSession.countDocuments({ userId }),
    BlanccoSession.countDocuments({ userId, status: SESSION_STATUS.PENDING }),
    BlanccoSession.countDocuments({ userId, status: SESSION_STATUS.SCANNED }),
    BlanccoSession.countDocuments({ userId, status: SESSION_STATUS.COMPLETED }),
    BlanccoSession.countDocuments({ userId, status: SESSION_STATUS.EXPIRED }),
  ]);

  return { total, pending, scanned, completed, expired };
};

const exportSessions = async (userId) => {
  const sessions = await BlanccoSession.find({ userId })
    .sort({ createdAt: -1 })
    .lean();

  return sessions.map(serializeSession);
};

module.exports = {
  createSession,
  scanSession,
  getSessionById,
  getReport,
  getSessions,
  getStats,
  exportSessions,
};
