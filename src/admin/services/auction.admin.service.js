const crypto = require('crypto');
const Auction = require('../../models/Auction.model');
const Bid = require('../../models/Bid.model');
const User = require('../../models/User.model');
const auctionService = require('../../services/auction.service');
const bidService = require('../../services/bid.service');
const blanccoProvider = require('../../services/providers/blanccoProvider');
const uploadService = require('../../services/upload.service');
const settingsService = require('../../services/settings.service');
const { SETTING_KEYS } = require('../../constants/settings');
const notificationService = require('../../services/notification.service');
const { NOTIFICATION_TYPE } = require('../../constants/notification');
const { AUCTION_STATUS, CLOSED_STATUSES, SELLER_TYPE } = require('../../constants/auctionEnums');
const ApiError = require('../../utils/apiError');
const httpStatus = require('../../constants/httpStatus');
const MESSAGES = require('../../constants/messages');

/* eslint-disable no-console */

/**
 * Auction moderation for the portal.
 *
 * Deliberately NOT a second way to run auctions: an admin cannot bid, change a
 * price, or pick a winner. The only write here is taking a listing down, which
 * is the one thing a marketplace operator genuinely has to be able to do —
 * a stolen handset, a fraudulent listing, an abusive description.
 *
 * Everything else is read-only visibility.
 */

const paginate = ({ page = 1, limit = 20 }) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  return { safePage, safeLimit, skip: (safePage - 1) * safeLimit };
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every auction, filterable. Includes drafts, which customers never see. */
const listAuctions = async ({ page, limit, status = null, sellerId = null, search = null } = {}) => {
  const { safePage, safeLimit, skip } = paginate({ page, limit });

  const query = {};
  if (status) query.status = { $in: String(status).split(',').map((s) => s.trim()) };
  if (sellerId) query.sellerId = sellerId;
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    query.$or = [{ 'device.brand': rx }, { 'device.model': rx }, { 'device.imei': rx }];
  }

  const [items, total] = await Promise.all([
    Auction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('sellerId', 'name mobile userType')
      .populate('winnerId', 'name mobile')
      .lean(),
    Auction.countDocuments(query),
  ]);

  return {
    items,
    serverTime: new Date(),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

/** One auction with everything an operator needs to judge it. */
const getAuction = async (auctionId) => {
  const auction = await Auction.findById(auctionId)
    .populate('sellerId', 'name mobile userType kycCompleted')
    .populate('winnerId', 'name mobile')
    .lean();

  if (!auction) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);

  const recentBids = await Bid.find({ auctionId })
    .sort({ createdAt: -1 })
    .limit(20)
    .populate('bidderId', 'name mobile')
    .lean();

  return { auction, recentBids, serverTime: new Date() };
};

/** An auction's full bid history, with bidders identified. */
const getBids = async (auctionId, { page, limit } = {}) => {
  const { safePage, safeLimit, skip } = paginate({ page, limit });

  const [items, total] = await Promise.all([
    Bid.find({ auctionId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('bidderId', 'name mobile')
      .lean(),
    Bid.countDocuments({ auctionId }),
  ]);

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

/**
 * Takes a listing down.
 *
 * Unlike the seller's own cancel, this works even when the auction has bids —
 * that is the whole point: a stolen handset must come down mid-auction, not
 * after it sells. Everyone who bid is told, because they are entitled to know
 * an auction they were committed to has been pulled.
 *
 * `reason` is required by the validator: taking someone's listing down without
 * a recorded reason is not something an operator should be able to do quietly.
 */
const takeDown = async (auctionId, { reason }, adminId) => {
  const auction = await Auction.findById(auctionId);
  if (!auction) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);

  if (CLOSED_STATUSES.includes(auction.status) && auction.status !== AUCTION_STATUS.PAYMENT_PENDING) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.ALREADY_CLOSED);
  }

  const claimed = await Auction.findOneAndUpdate(
    { _id: auctionId, status: auction.status },
    {
      status: AUCTION_STATUS.CANCELLED,
      cancelledReason: reason,
      closedAt: new Date(),
    },
    { new: true }
  );

  if (!claimed) throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.ALREADY_CLOSED);

  const label = `${claimed.device?.brand || ''} ${claimed.device?.model || ''}`.trim() || 'a device';
  const bidders = await Bid.distinct('bidderId', { auctionId });

  const tell = async (userId, title, body) => {
    try {
      await notificationService.notifyUser(userId, {
        title,
        body,
        type: NOTIFICATION_TYPE.AUCTION,
        data: { auctionId: String(claimed._id), outcome: AUCTION_STATUS.CANCELLED },
      });
    } catch (err) {
      console.error('[Auction] takedown notification failed', String(userId), err.message);
    }
  };

  await tell(
    claimed.sellerId,
    'Your listing was removed',
    `${label} was taken down by our team. Reason: ${reason}`
  );

  await Promise.all(
    bidders.map((id) =>
      tell(id, 'An auction you bid on was removed', `${label} was taken down and will not be sold.`)
    )
  );

  console.log('[Auction] taken down', String(claimed._id), 'by admin', String(adminId), '-', reason);

  return auctionService.decorate(claimed, {});
};

/* ------------------------------------------------------------------ *
 * Grest's own listings
 * ------------------------------------------------------------------ */

const PLATFORM_SELLER_MOBILE = '0000000000';

/**
 * The account that owns Grest's own listings.
 *
 * `Auction.sellerId` is a required ref to a User, and making it nullable would
 * mean touching every query, populate and index that assumes a seller exists.
 * A single system account is the cheaper answer: everything downstream keeps
 * working, and `sellerType` is what actually distinguishes a platform listing.
 *
 * Created on first use so a fresh database needs no seeding. It is not a real
 * account — the mobile is unreachable and it has no auth tokens — so nobody can
 * sign in as it.
 */
const getPlatformSeller = async () => {
  const existing = await User.findOne({ mobile: PLATFORM_SELLER_MOBILE });
  if (existing) return existing;

  try {
    return await User.create({
      mobile: PLATFORM_SELLER_MOBILE,
      countryCode: '+91',
      name: 'Grest',
      isMobileVerified: true,
      kycCompleted: true,
    });
  } catch (err) {
    // Two admins creating a listing at the same moment raced us.
    if (err.code === 11000) return User.findOne({ mobile: PLATFORM_SELLER_MOBILE });
    throw err;
  }
};

/**
 * Shapes a Blancco report for storage on a listing.
 *
 * Only what a buyer or an operator actually needs is kept. The full payload is
 * not stored on the auction — Blancco holds it, and `reportId` is the way back
 * to it — so a listing document stays a listing rather than a copy of a vendor
 * system.
 */
const toDiagnosisReport = (report) => ({
  grade: report.grade,
  imei: report.device.imei,
  reportId: report.reportId,
  diagnosedAt: report.diagnosedAt,
  source: report.sourceVersion ? `${report.source} ${report.sourceVersion}` : report.source,
  properties: {
    modelName: report.device.marketName || report.device.model,
    manufacturer: report.device.manufacturer,
    color: report.device.color,
    ram: report.device.ram,
    serial: report.device.serial,
    osVersion: report.device.firmwareVersion,
    modelNumber: report.device.modelNumber,
  },
  locks: report.locks,
  battery: {
    healthPercent: report.battery.healthPercent,
    cycles: report.battery.cycles,
    designCapacityMah: report.battery.designCapacityMah,
    currentCapacityMah: report.battery.currentCapacityMah,
  },
  passed: report.passed,
  failed: report.failed,
  skipped: report.skipped,
  total: report.total,
  // Flattened for display. The raw per-test vocabulary stays out of the app.
  tests: report.tests.map((t) => ({ name: t.name, result: t.result })),
});

/**
 * Looks a handset up in Blancco by IMEI, for the admin "add a device" screen.
 *
 * This is a READ of a report Blancco's app already produced — it does not run
 * a diagnosis. A device that has never been through that app has no report,
 * which is a 404 here rather than an error: nothing is broken.
 *
 * The response doubles as form prefill (make, model, colour, RAM) so an
 * operator types an IMEI rather than a specification.
 */
const lookupImei = async (imei) => {
  if (!blanccoProvider.isConfigured()) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, MESSAGES.AUCTION.DIAGNOSIS_NOT_CONFIGURED);
  }

  const outcome = await blanccoProvider.diagnose({ imei });

  if (outcome.resultStatus === blanccoProvider.RESULT_STATUS.ERROR) {
    throw new ApiError(httpStatus.BAD_GATEWAY, MESSAGES.AUCTION.DIAGNOSIS_LOOKUP_FAILED);
  }
  if (outcome.resultStatus !== blanccoProvider.RESULT_STATUS.SUCCESS || !outcome.result) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.DIAGNOSIS_NO_REPORT, [
      { field: 'imei', message: MESSAGES.AUCTION.DIAGNOSIS_NO_REPORT, imei: String(imei) },
    ]);
  }

  const report = outcome.result;

  return {
    report: toDiagnosisReport(report),
    // Everything the create-listing form can fill in for itself.
    prefill: {
      device: {
        brand: report.device.manufacturer ? report.device.manufacturer.split(',')[0].trim() : null,
        model: report.device.marketName || report.device.model,
        color: report.device.color,
        imei: report.device.imei,
      },
      grade: report.grade,
      batteryHealthPercent: report.battery.healthPercent,
    },
    // Surfaced separately so the portal can refuse to list before the operator
    // has done the work of composing a draft.
    sellable: report.grade !== 'LOCKED',
    locks: report.locks,
  };
};

/**
 * Creates a Grest listing as a draft. Same validation and lifecycle as a vendor
 * listing — it just belongs to the platform account and is marked PLATFORM, so
 * publishing it is never charged a listing credit.
 *
 * When the payload carries an IMEI and no report of its own, Blancco is asked
 * for one and it is attached. Best-effort: a device Blancco has never seen is
 * still a device Grest can sell, so a miss leaves the listing unverified rather
 * than refusing to create it.
 */
const createListing = async (payload, adminId) => {
  const seller = await getPlatformSeller();

  let diagnosisReport = payload.diagnosisReport || null;

  if (!diagnosisReport && payload.device?.imei && blanccoProvider.isConfigured()) {
    try {
      const outcome = await blanccoProvider.diagnose({ imei: payload.device.imei });
      if (outcome.resultStatus === blanccoProvider.RESULT_STATUS.SUCCESS && outcome.result) {
        diagnosisReport = toDiagnosisReport(outcome.result);
      }
    } catch (err) {
      console.error('[Auction] Blancco lookup failed on create', payload.device.imei, err.message);
    }
  }

  const auction = await Auction.create({
    sellerId: seller._id,
    sellerType: SELLER_TYPE.PLATFORM,
    status: AUCTION_STATUS.DRAFT,
    device: payload.device,
    condition: payload.condition,
    conditionNotes: payload.conditionNotes || null,
    diagnosisReport,
    photos: payload.photos || [],
    startPricePaise: payload.startPricePaise,
    bidIncrementPaise: payload.bidIncrementPaise,
    buyNowPricePaise: payload.buyNowPricePaise ?? null,
    startAt: payload.startAt,
    endAt: payload.endAt,
  });

  console.log('[Auction] platform listing created', String(auction._id), 'by admin', String(adminId));

  return auctionService.decorate(auction, { viewerId: seller._id });
};

const EDITABLE = [
  'device',
  'condition',
  'conditionNotes',
  'diagnosisReport',
  'photos',
  'startPricePaise',
  'bidIncrementPaise',
  'buyNowPricePaise',
  'startAt',
  'endAt',
];

/**
 * Uploads device photos onto a Grest draft.
 *
 * The portal posts the files and this server puts them in S3, rather than the
 * browser uploading directly: that would mean handing the admin portal its own
 * AWS credentials, and the bucket is already reachable from here. Files are
 * held in memory and streamed straight out — they never touch local disk.
 */
const addPhotos = async (auctionId, files) => {
  const auction = await Auction.findById(auctionId);
  if (!auction) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);

  if (auction.status !== AUCTION_STATUS.DRAFT) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.NOT_EDITABLE);
  }
  if (!files || files.length === 0) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.AUCTION.NO_FILES);
  }

  const maxPhotos = await settingsService.get(SETTING_KEYS.AUCTION_MAX_PHOTOS);
  if (auction.photos.length + files.length > maxPhotos) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.AUCTION.TOO_MANY_PHOTOS, [
      {
        field: 'photos',
        message: `A listing may carry at most ${maxPhotos} photos.`,
        current: auction.photos.length,
        max: maxPhotos,
      },
    ]);
  }

  const uploaded = [];
  for (const file of files) {
    const publicId = `${auction._id}-${crypto.randomBytes(6).toString('hex')}`;
    // Sequential: these are multi-megabyte uploads and firing eight at once
    // buys nothing but memory pressure on a small instance.
    // eslint-disable-next-line no-await-in-loop
    const stored = await uploadService.uploadAuctionPhoto(file.buffer, publicId, file.mimetype);
    uploaded.push({ url: stored.url, publicId: stored.publicId });
  }

  auction.photos.push(...uploaded);
  await auction.save();

  return auctionService.decorate(auction, { viewerId: auction.sellerId });
};

/** Removes one photo from a draft, and the stored object behind it. */
const removePhoto = async (auctionId, photoId) => {
  const auction = await Auction.findById(auctionId);
  if (!auction) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);

  if (auction.status !== AUCTION_STATUS.DRAFT) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.NOT_EDITABLE);
  }

  const photo = auction.photos.id(photoId);
  if (!photo) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.PHOTO_NOT_FOUND);

  const { publicId } = photo;
  photo.deleteOne();
  await auction.save();

  // Best-effort: the listing is already correct, and a storage hiccup must not
  // fail the request. Worst case the object is orphaned, not wrongly shown.
  try {
    await uploadService.deleteProfileImage(publicId);
  } catch (err) {
    console.error('[Auction] failed to delete photo object', publicId, err.message);
  }

  return auctionService.decorate(auction, { viewerId: auction.sellerId });
};

/** Edits a draft. Published terms stay frozen, exactly as for a vendor. */
const updateListing = async (auctionId, payload) => {
  const auction = await Auction.findById(auctionId);
  if (!auction) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);

  if (auction.status !== AUCTION_STATUS.DRAFT) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.NOT_EDITABLE);
  }

  EDITABLE.forEach((field) => {
    if (payload[field] !== undefined) auction[field] = payload[field];
  });

  await auction.save();

  return auctionService.decorate(auction, { viewerId: auction.sellerId });
};

/**
 * Publishes a Grest listing.
 *
 * Deliberately does NOT go through auctionService.publish: that path charges a
 * listing credit, and Grest billing itself for its own stock is meaningless.
 * Every other rule — photos required, a blocked or stolen IMEI refused, the
 * duration bounds — is shared, because those protect the buyer regardless of
 * who is selling.
 */
const publishListing = async (auctionId) => {
  const auction = await Auction.findById(auctionId);
  if (!auction) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);

  return auctionService.publishWithoutCharge(auction);
};

/**
 * Puts an unsold device back up.
 *
 * Clones the listing into a fresh draft rather than reopening the old one: the
 * finished auction is a record of what happened, with its own bids and its own
 * defaulters, and reviving it would rewrite that history. The new draft carries
 * no bids, no winner and no passed bidders — so someone who failed to pay last
 * time is free to bid again, which is the intended behaviour.
 */
const relist = async (auctionId, adminId) => {
  const source = await Auction.findById(auctionId).lean();
  if (!source) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);

  const relistable = [
    AUCTION_STATUS.ENDED_NO_BIDS,
    AUCTION_STATUS.PAYMENT_EXPIRED,
    AUCTION_STATUS.CANCELLED,
  ];

  if (!relistable.includes(source.status)) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.NOT_RELISTABLE, [
      { field: 'status', message: `An auction that is ${source.status} cannot be relisted.` },
    ]);
  }

  const durationMs = source.endAt - source.startAt;
  const startAt = new Date();

  const copy = await Auction.create({
    sellerId: source.sellerId,
    sellerType: source.sellerType,
    status: AUCTION_STATUS.DRAFT,
    device: source.device,
    condition: source.condition,
    conditionNotes: source.conditionNotes,
    diagnosisReport: source.diagnosisReport,
    photos: (source.photos || []).map((p) => ({ url: p.url, publicId: p.publicId })),
    diagnoseSessionId: source.diagnoseSessionId,
    imeiVerificationId: source.imeiVerificationId,
    startPricePaise: source.startPricePaise,
    bidIncrementPaise: source.bidIncrementPaise,
    buyNowPricePaise: source.buyNowPricePaise,
    startAt,
    endAt: new Date(startAt.getTime() + durationMs),
  });

  console.log(
    '[Auction] relisted',
    String(source._id),
    'as',
    String(copy._id),
    'by admin',
    String(adminId)
  );

  return auctionService.decorate(copy, { viewerId: copy.sellerId });
};

/** Dashboard counters for the auctions tab. */
const getStats = async () => {
  const now = new Date();

  const [byStatus, liveEndingSoon, bidsToday, grossSoldPaise] = await Promise.all([
    Auction.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Auction.countDocuments({
      status: AUCTION_STATUS.LIVE,
      endAt: { $gt: now, $lte: new Date(now.getTime() + 60 * 60 * 1000) },
    }),
    Bid.countDocuments({ createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }),
    Auction.aggregate([
      { $match: { status: AUCTION_STATUS.SOLD } },
      { $group: { _id: null, total: { $sum: '$currentBidPaise' } } },
    ]),
  ]);

  return {
    byStatus: Object.fromEntries(byStatus.map((row) => [row._id, row.count])),
    liveEndingWithinHour: liveEndingSoon,
    bidsLast24h: bidsToday,
    grossSoldPaise: grossSoldPaise[0]?.total || 0,
    grossSoldInr: (grossSoldPaise[0]?.total || 0) / 100,
  };
};

module.exports = {
  getPlatformSeller,
  lookupImei,
  toDiagnosisReport,
  createListing,
  addPhotos,
  removePhoto,
  updateListing,
  publishListing,
  relist,
  listAuctions,
  getAuction,
  getBids,
  takeDown,
  getStats,
  // Re-exported so the controller can shape a bid list the same way the
  // customer-facing history does when it needs to.
  minNextBidPaise: bidService.minNextBidPaise,
};
