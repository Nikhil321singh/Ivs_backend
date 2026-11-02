const BiddingKyc = require('../../models/BiddingKyc.model');
const { BIDDING_KYC_STATUS } = require('../../models/BiddingKyc.model');
const User = require('../../models/User.model');
const ApiError = require('../../utils/apiError');
const httpStatus = require('../../constants/httpStatus');
const MESSAGES = require('../../constants/messages');

const list = async ({ page = 1, limit = 20, status } = {}) => {
  const query = {};
  if (status) query.status = status;

  const skip = (page - 1) * limit;
  const [applications, total] = await Promise.all([
    BiddingKyc.find(query)
      .populate('userId', 'name mobile countryCode userType')
      .populate('reviewedBy', 'email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    BiddingKyc.countDocuments(query),
  ]);

  return { applications, total, page: Number(page), limit: Number(limit) };
};

const getOne = async (id) => {
  const application = await BiddingKyc.findById(id)
    .populate('userId', 'name mobile countryCode email userType kycCompleted')
    .populate('reviewedBy', 'email');

  if (!application) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.BIDDING_KYC.NOT_FOUND);
  }
  return application;
};

const approve = async (id, adminId) => {
  const application = await BiddingKyc.findById(id);
  if (!application) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.BIDDING_KYC.NOT_FOUND);
  }
  if (application.status !== BIDDING_KYC_STATUS.PENDING) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.BIDDING_KYC.NOT_PENDING);
  }

  application.status = BIDDING_KYC_STATUS.APPROVED;
  application.rejectionReason = null;
  application.reviewedBy = adminId;
  application.reviewedAt = new Date();
  await application.save();

  await User.findByIdAndUpdate(application.userId, {
    biddingKycStatus: BIDDING_KYC_STATUS.APPROVED,
  });

  return application;
};

const reject = async (id, reason, adminId) => {
  const application = await BiddingKyc.findById(id);
  if (!application) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.BIDDING_KYC.NOT_FOUND);
  }
  if (application.status !== BIDDING_KYC_STATUS.PENDING) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.BIDDING_KYC.NOT_PENDING);
  }

  application.status = BIDDING_KYC_STATUS.REJECTED;
  application.rejectionReason = reason;
  application.reviewedBy = adminId;
  application.reviewedAt = new Date();
  await application.save();

  await User.findByIdAndUpdate(application.userId, {
    biddingKycStatus: BIDDING_KYC_STATUS.REJECTED,
  });

  return application;
};

module.exports = { list, getOne, approve, reject };
