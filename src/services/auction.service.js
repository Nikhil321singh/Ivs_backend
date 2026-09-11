const crypto = require('crypto');
const mongoose = require('mongoose');
const Auction = require('../models/Auction.model');
const DiagnoseSession = require('../models/DiagnoseSession.model');
const ImeiVerificationLog = require('../models/ImeiVerificationLog.model');
const auctionCloser = require('./auctionCloser.service');
const bidService = require('./bid.service');
const uploadService = require('./upload.service');
const settingsService = require('./settings.service');
const featureBilling = require('./featureBilling.service');
const { IVS_STATUS } = require('./providers/cdotIvsProvider');
const { SETTING_KEYS } = require('../constants/settings');
const {
  AUCTION_STATUS,
  DIAGNOSTIC_STATUS,
  AUCTION_SORT,
} = require('../constants/auctionEnums');
const { ENTITLEMENT_REF_TYPE } = require('../constants/entitlementEnums');
const { TXN_REF_TYPE } = require('../constants/walletEnums');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/* eslint-disable no-console */

/**
 * The listing lifecycle: draft, photos, publish, browse, cancel.
 *
 * Two rules shape this file.
 *
 * SERVER TIME IS THE ONLY TIME. Every response carries `serverTime` and a
 * computed `secondsRemaining`, and every decision about whether an auction is
 * running is made by comparing `new Date()` against `endAt` in the database.
 * A client's clock is never read, and a client-sent timestamp is never trusted.
 *
 * THE DIAGNOSIS AND IMEI CHECK ARE REFERENCED, NEVER COPIED. A listing points
 * at the real DiagnoseSession and ImeiVerificationLog rows the seller already
 * paid for. Only two derived fields are denormalised onto the auction —
 * `diagnosticStatus` and `imeiStatus` — and purely so the browse filters can
 * use an index instead of joining both collections on every page.
 */

const EDITABLE_FIELDS = [
  'device',
  'condition',
  'conditionNotes',
  'diagnoseSessionId',
  'imeiVerificationId',
  'startPricePaise',
  'bidIncrementPaise',
  'startAt',
  'endAt',
];

const ensureObjectId = (id, message) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(httpStatus.NOT_FOUND, message);
  return id;
};

const secondsRemaining = (endAt, now) => Math.max(0, Math.floor((endAt - now) / 1000));

/**
 * Shapes an auction for the API. `viewerId` decides what is safe to include:
 * the seller and the winner see each other's contact details once a sale is
 * pending, and nobody else ever does.
 */
const decorate = (auction, { viewerId = null, diagnosis = null, verification = null } = {}) => {
  const now = new Date();
  const isSeller = viewerId && String(auction.sellerId?._id || auction.sellerId) === String(viewerId);
  const isWinner = viewerId && String(auction.winnerId || '') === String(viewerId);
  const live = auction.status === AUCTION_STATUS.LIVE;

  const seller = auction.sellerId?.name !== undefined ? auction.sellerId : null;

  const payload = {
    id: String(auction._id),
    status: auction.status,
    device: auction.device,
    condition: auction.condition,
    conditionNotes: auction.conditionNotes,
    photos: (auction.photos || []).map((photo) => ({
      id: String(photo._id),
      url: photo.url,
    })),

    diagnosticStatus: auction.diagnosticStatus,
    imeiStatus: auction.imeiStatus,
    hasDiagnosis: !!auction.diagnoseSessionId,
    hasImeiCheck: !!auction.imeiVerificationId,

    startPricePaise: auction.startPricePaise,
    startPriceInr: auction.startPricePaise / 100,
    bidIncrementPaise: auction.bidIncrementPaise,
    bidIncrementInr: auction.bidIncrementPaise / 100,

    currentBidPaise: auction.currentBidPaise,
    currentBidInr: auction.currentBidPaise === null ? null : auction.currentBidPaise / 100,
    minNextBidPaise: bidService.minNextBidPaise(auction),
    minNextBidInr: bidService.minNextBidPaise(auction) / 100,
    bidCount: auction.bidCount,

    startAt: auction.startAt,
    endAt: auction.endAt,
    // Both are given so a client can run a countdown WITHOUT trusting its own
    // clock: it takes secondsRemaining and ticks down locally, re-syncing on
    // the next request rather than computing from endAt against device time.
    serverTime: now,
    secondsRemaining: live ? secondsRemaining(auction.endAt, now) : 0,
    extended: (auction.extensionCount || 0) > 0,

    seller: seller ? { id: String(seller._id), name: seller.name || null } : undefined,
    isSeller: !!isSeller,
    isHighestBidder:
      !!viewerId && String(auction.currentBidderId || '') === String(viewerId),

    createdAt: auction.createdAt,
  };

  if (diagnosis) payload.diagnosis = diagnosis;
  if (verification) payload.imeiVerification = verification;

  if (isSeller) {
    payload.listingCost = auction.listingCost;
    payload.cancelledReason = auction.cancelledReason;
  }

  // Outcome is private to the two people it concerns. A browser looking at a
  // finished auction sees that it sold, not who bought it.
  if (isSeller || isWinner) {
    payload.winnerId = auction.winnerId ? String(auction.winnerId) : null;
    payload.paymentDueAt = auction.paymentDueAt;
    payload.soldAt = auction.soldAt;
    payload.youWon = !!isWinner;
  }

  return payload;
};

/** Resolves and authorises the references a listing may carry. */
const resolveReferences = async (userId, { diagnoseSessionId, imeiVerificationId }) => {
  const result = { diagnosis: null, verification: null };

  if (diagnoseSessionId) {
    const diagnosis = await DiagnoseSession.findById(diagnoseSessionId);
    if (!diagnosis) {
      throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.DIAGNOSIS_NOT_FOUND);
    }
    // A seller can only vouch for a diagnosis they ran. Without this, anyone
    // could attach someone else's clean report to their own listing.
    if (String(diagnosis.userId) !== String(userId)) {
      throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.AUCTION.DIAGNOSIS_NOT_YOURS);
    }
    result.diagnosis = diagnosis;
  }

  if (imeiVerificationId) {
    const verification = await ImeiVerificationLog.findById(imeiVerificationId);
    if (!verification) {
      throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.VERIFICATION_NOT_FOUND);
    }
    if (String(verification.userId) !== String(userId)) {
      throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.AUCTION.VERIFICATION_NOT_YOURS);
    }
    result.verification = verification;
  }

  return result;
};

const loadOwned = async (userId, auctionId) => {
  ensureObjectId(auctionId, MESSAGES.AUCTION.NOT_FOUND);

  const auction = await Auction.findById(auctionId);
  if (!auction) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);
  if (String(auction.sellerId) !== String(userId)) {
    throw new ApiError(httpStatus.FORBIDDEN, MESSAGES.AUCTION.NOT_YOURS);
  }

  return auction;
};

const create = async (userId, payload) => {
  await resolveReferences(userId, payload);

  const auction = await Auction.create({
    sellerId: userId,
    status: AUCTION_STATUS.DRAFT,
    device: payload.device,
    condition: payload.condition,
    conditionNotes: payload.conditionNotes || null,
    diagnoseSessionId: payload.diagnoseSessionId || null,
    imeiVerificationId: payload.imeiVerificationId || null,
    startPricePaise: payload.startPricePaise,
    bidIncrementPaise: payload.bidIncrementPaise,
    startAt: payload.startAt,
    endAt: payload.endAt,
  });

  return decorate(auction, { viewerId: userId });
};

const update = async (userId, auctionId, payload) => {
  const auction = await loadOwned(userId, auctionId);

  // A published auction's terms are frozen. People bid against a price and a
  // deadline; letting a seller move either after the fact is the single most
  // abusable thing a marketplace can allow.
  if (auction.status !== AUCTION_STATUS.DRAFT) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.NOT_EDITABLE);
  }

  await resolveReferences(userId, {
    diagnoseSessionId: payload.diagnoseSessionId ?? auction.diagnoseSessionId,
    imeiVerificationId: payload.imeiVerificationId ?? auction.imeiVerificationId,
  });

  EDITABLE_FIELDS.forEach((field) => {
    if (payload[field] !== undefined) auction[field] = payload[field];
  });

  await auction.save();

  return decorate(auction, { viewerId: userId });
};

const addPhotos = async (userId, auctionId, files) => {
  const auction = await loadOwned(userId, auctionId);

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

  return decorate(auction, { viewerId: userId });
};

const removePhoto = async (userId, auctionId, photoId) => {
  const auction = await loadOwned(userId, auctionId);

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

  return decorate(auction, { viewerId: userId });
};

/**
 * Every rule a draft must satisfy before it can be seen or bid on. Returns the
 * start time the auction will actually run from.
 *
 * A start time in the past is CLAMPED TO NOW rather than refused. The seller
 * picked it when they created the draft, and the minutes spent uploading photos
 * and checking the IMEI since then are not a mistake to punish them for —
 * "start at 3pm" published at 3:07 plainly means "start now". What genuinely
 * cannot be allowed is an auction that is already over, and that falls out of
 * the window check below once the start is clamped.
 */
const assertPublishable = async (auction, settings) => {
  const now = new Date();

  if (auction.status !== AUCTION_STATUS.DRAFT) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.NOT_DRAFT);
  }
  if (!auction.photos || auction.photos.length === 0) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.AUCTION.PHOTO_REQUIRED);
  }

  const effectiveStartAt = auction.startAt < now ? now : auction.startAt;

  if (auction.endAt <= effectiveStartAt) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.AUCTION.INVALID_WINDOW);
  }

  const durationMs = auction.endAt - effectiveStartAt;
  const minMs = settings[SETTING_KEYS.AUCTION_MIN_DURATION_MINUTES] * 60 * 1000;
  const maxMs = settings[SETTING_KEYS.AUCTION_MAX_DURATION_DAYS] * 24 * 60 * 60 * 1000;

  if (durationMs < minMs) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.AUCTION.TOO_SHORT, [
      {
        field: 'endAt',
        message: `An auction must run for at least ${settings[SETTING_KEYS.AUCTION_MIN_DURATION_MINUTES]} minutes.`,
      },
    ]);
  }
  if (durationMs > maxMs) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.AUCTION.TOO_LONG, [
      {
        field: 'endAt',
        message: `An auction may run for at most ${settings[SETTING_KEYS.AUCTION_MAX_DURATION_DAYS]} days.`,
      },
    ]);
  }

  return effectiveStartAt;
};

/**
 * Publishes a draft: validates it, charges the listing fee, and puts it live
 * (or schedules it).
 *
 * The listing fee is charged LAST, after every check has passed, for the same
 * reason IVS charges after C-DOT answers: a seller must never pay for a
 * listing that was then refused.
 */
const publish = async (userId, auctionId, { billingSource, cost = 0 }) => {
  const auction = await loadOwned(userId, auctionId);
  const settings = await settingsService.getAll();

  const effectiveStartAt = await assertPublishable(auction, settings);

  const { diagnosis, verification } = await resolveReferences(userId, {
    diagnoseSessionId: auction.diagnoseSessionId,
    imeiVerificationId: auction.imeiVerificationId,
  });

  const diagnosticStatus =
    diagnosis && diagnosis.resultStatus === DiagnoseSession.RESULT_STATUS.SUCCESS
      ? DIAGNOSTIC_STATUS.VERIFIED
      : DIAGNOSTIC_STATUS.UNVERIFIED;

  if (
    settings[SETTING_KEYS.AUCTION_REQUIRE_DIAGNOSIS] === true &&
    diagnosticStatus !== DIAGNOSTIC_STATUS.VERIFIED
  ) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.AUCTION.DIAGNOSIS_REQUIRED);
  }

  const imeiStatus = verification ? verification.imei1Status : null;

  // The one rule worth refusing money over. We already hold CEIR's answer for
  // this handset; listing it anyway would be knowingly putting a stolen phone
  // in front of buyers.
  if (imeiStatus === IVS_STATUS.BLOCKED || imeiStatus === IVS_STATUS.STOLEN) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.AUCTION.IMEI_NOT_CLEAN, [
      { field: 'imeiVerificationId', message: `CEIR reports this IMEI as ${imeiStatus}.`, imeiStatus },
    ]);
  }

  const now = new Date();
  const goesLiveNow = effectiveStartAt <= now;

  // Claim the draft atomically, so a double-tapped publish cannot charge the
  // seller twice: the second call finds no DRAFT to claim.
  const claimed = await Auction.findOneAndUpdate(
    { _id: auction._id, status: AUCTION_STATUS.DRAFT },
    {
      status: goesLiveNow ? AUCTION_STATUS.LIVE : AUCTION_STATUS.SCHEDULED,
      // Persist the clamped start, so the auction's own record matches when it
      // actually began rather than when the seller first drafted it.
      startAt: effectiveStartAt,
      diagnosticStatus,
      imeiStatus,
      originalEndAt: auction.endAt,
    },
    { new: true }
  );

  if (!claimed) throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.NOT_DRAFT);

  try {
    const charge = await featureBilling.chargeFeature(userId, 'AUCTION_LISTING', {
      billingSource,
      cost,
      referenceType:
        billingSource === 'ENTITLEMENT'
          ? ENTITLEMENT_REF_TYPE.AUCTION_LISTING
          : TXN_REF_TYPE.AUCTION_LISTING,
      referenceId: claimed._id,
      // Keyed on the auction, so a retried publish never charges twice.
      idempotencyKey: `auction-listing:${claimed._id}`,
      metadata: { auctionId: String(claimed._id) },
    });

    claimed.listingCost = charge.cost;
    claimed.listingChargeSource = charge.source;
    await claimed.save();
  } catch (err) {
    // Could not charge — put the listing back in draft rather than leaving a
    // live auction nobody paid for.
    await Auction.updateOne(
      { _id: claimed._id, bidCount: 0 },
      { status: AUCTION_STATUS.DRAFT, diagnosticStatus: DIAGNOSTIC_STATUS.UNVERIFIED }
    );
    throw err;
  }

  return decorate(claimed, { viewerId: userId });
};

const cancel = async (userId, auctionId, reason = null) => {
  const auction = await loadOwned(userId, auctionId);

  if ([AUCTION_STATUS.SOLD, AUCTION_STATUS.CANCELLED].includes(auction.status)) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.ALREADY_CLOSED);
  }

  // Once someone has bid, the seller is committed. Pulling a listing out from
  // under live bidders is how a marketplace loses its bidders.
  if (auction.bidCount > 0) {
    throw new ApiError(httpStatus.CONFLICT, MESSAGES.AUCTION.HAS_BIDS);
  }

  auction.status = AUCTION_STATUS.CANCELLED;
  auction.cancelledReason = reason;
  auction.closedAt = new Date();
  await auction.save();

  return decorate(auction, { viewerId: userId });
};

const SORTS = Object.freeze({
  [AUCTION_SORT.ENDING_SOON]: { endAt: 1 },
  [AUCTION_SORT.NEWEST]: { createdAt: -1 },
  [AUCTION_SORT.PRICE_LOW]: { currentBidPaise: 1, startPricePaise: 1 },
  [AUCTION_SORT.PRICE_HIGH]: { currentBidPaise: -1, startPricePaise: -1 },
  [AUCTION_SORT.MOST_BIDS]: { bidCount: -1 },
});

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The live-auction board, with the filters the brief asks for.
 *
 * Only LIVE auctions are listed, and `endAt > now` is part of the query rather
 * than a post-filter — an expired auction the sweeper has not reached yet must
 * never appear as biddable.
 */
const browse = async (filters = {}, viewerId = null) => {
  const {
    brand,
    condition,
    storageGb,
    diagnosticStatus,
    minPricePaise,
    maxPricePaise,
    endingSoonMinutes,
    search,
    sort = AUCTION_SORT.ENDING_SOON,
    page = 1,
    limit = 20,
  } = filters;

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;
  const now = new Date();

  const query = { status: AUCTION_STATUS.LIVE, endAt: { $gt: now } };

  if (brand) query['device.brand'] = new RegExp(`^${escapeRegex(brand)}$`, 'i');
  if (condition) {
    query.condition = { $in: Array.isArray(condition) ? condition : String(condition).split(',') };
  }
  if (storageGb) query['device.storageGb'] = parseInt(storageGb, 10);
  if (diagnosticStatus) query.diagnosticStatus = diagnosticStatus;

  // Price filters compare against what it would cost to bid NOW — the current
  // bid where there is one, the start price where there is not. That is the
  // number the buyer is actually deciding on.
  if (minPricePaise || maxPricePaise) {
    const bounds = {};
    if (minPricePaise) bounds.$gte = parseInt(minPricePaise, 10);
    if (maxPricePaise) bounds.$lte = parseInt(maxPricePaise, 10);
    query.$or = [
      { currentBidPaise: { ...bounds, $ne: null } },
      { currentBidPaise: null, startPricePaise: bounds },
    ];
  }

  if (endingSoonMinutes) {
    query.endAt = {
      $gt: now,
      $lte: new Date(now.getTime() + parseInt(endingSoonMinutes, 10) * 60 * 1000),
    };
  }

  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    const searchOr = [{ 'device.brand': rx }, { 'device.model': rx }, { 'device.color': rx }];
    // Combined with $and so a price $or and a search $or cannot overwrite each
    // other — the classic way two independent filters silently become one.
    if (query.$or) {
      query.$and = [{ $or: query.$or }, { $or: searchOr }];
      delete query.$or;
    } else {
      query.$or = searchOr;
    }
  }

  const [rows, total] = await Promise.all([
    Auction.find(query)
      .sort(SORTS[sort] || SORTS[AUCTION_SORT.ENDING_SOON])
      .skip(skip)
      .limit(safeLimit)
      .populate('sellerId', 'name')
      .lean(),
    Auction.countDocuments(query),
  ]);

  return {
    items: rows.map((row) => decorate(row, { viewerId })),
    serverTime: now,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

/** One auction in full, including the linked diagnosis and IMEI result. */
const getById = async (auctionId, viewerId = null) => {
  ensureObjectId(auctionId, MESSAGES.AUCTION.NOT_FOUND);

  let auction = await Auction.findById(auctionId).populate('sellerId', 'name');
  if (!auction) throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);

  // A draft is nobody's business but its seller's.
  if (auction.status === AUCTION_STATUS.DRAFT && String(auction.sellerId._id) !== String(viewerId)) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.AUCTION.NOT_FOUND);
  }

  auction = await auctionCloser.ensureClosed(auction);
  if (!auction.sellerId?.name) await auction.populate('sellerId', 'name');

  const [diagnosis, verification] = await Promise.all([
    auction.diagnoseSessionId
      ? DiagnoseSession.findById(auction.diagnoseSessionId).select('resultStatus result createdAt').lean()
      : null,
    auction.imeiVerificationId
      ? ImeiVerificationLog.findById(auction.imeiVerificationId)
          .select('imei1Status imei2Status allowTransaction referenceId verifiedAt')
          .lean()
      : null,
  ]);

  return decorate(auction, { viewerId, diagnosis, verification });
};

/** The seller's own listings, filterable by status (Draft / Live / Ended / Sold). */
const myListings = async (userId, { status = null, page = 1, limit = 20 } = {}) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const query = { sellerId: userId };
  if (status) {
    query.status = { $in: Array.isArray(status) ? status : String(status).split(',') };
  }

  const [rows, total] = await Promise.all([
    Auction.find(query).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
    Auction.countDocuments(query),
  ]);

  return {
    items: rows.map((row) => decorate(row, { viewerId: userId })),
    serverTime: new Date(),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

module.exports = {
  create,
  update,
  addPhotos,
  removePhoto,
  publish,
  cancel,
  browse,
  getById,
  myListings,
  decorate,
  loadOwned,
};
