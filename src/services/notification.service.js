const Notification = require('../models/Notification.model');
const NotificationCampaign = require('../models/NotificationCampaign.model');
const DeviceToken = require('../models/DeviceToken.model');
const User = require('../models/User.model');
const deviceTokenService = require('./deviceToken.service');
const fcmProvider = require('./providers/fcmProvider');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const USER_STATUS = require('../constants/userStatus');
const { isOlderThan } = require('../utils/version.util');
const {
  NOTIFICATION_TYPE,
  AUDIENCE_MODE,
  CAMPAIGN_STATUS,
} = require('../constants/notification');

/* eslint-disable no-console */

/**
 * Notifications: the inbox, and the push that accompanies it.
 *
 * Two rules run through everything here.
 *
 * 1. The database write is the notification; the push is a courtesy. A phone
 *    can be off, a token stale, FCM down — none of that may lose the message or
 *    fail the request that triggered it. So the inbox row is written first and a
 *    push failure is recorded, never thrown.
 *
 * 2. Audiences are resolved in pages. A broadcast to every user must not load
 *    every user, or every device token, into memory at once.
 */

// Users per batch when writing inbox rows and pushing. Big enough that a
// 10,000-user broadcast is ~20 round trips, small enough that one batch's
// working set stays trivial.
const BATCH_SIZE = 500;

// A broadcast smaller than this is delivered before the admin's HTTP request
// returns, so the console can show real numbers immediately. Anything larger
// runs in the background and the console polls the campaign for progress —
// keeping a request open for a 50,000-user send would just time out behind the
// proxy.
const SYNC_AUDIENCE_LIMIT = 500;

/** Blocked and deleted accounts never receive anything. */
const REACHABLE_USER_FILTER = {
  status: { $nin: [USER_STATUS.BLOCKED, USER_STATUS.DELETED] },
};

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

/**
 * Pushes an already-persisted notification to a set of device tokens and
 * retires any token FCM reports as dead.
 *
 * Never throws — see rule 1 above.
 */
const pushToTokens = async (tokens, { title, body, imageUrl, data }) => {
  const summary = await fcmProvider.sendToTokens(tokens, { title, body, imageUrl, data });

  if (summary.invalidTokens.length > 0) {
    await deviceTokenService.retireInvalidTokens(summary.invalidTokens);
  }

  return summary;
};

/**
 * Notifies one user: writes their inbox row, then pushes to every device they
 * have registered.
 *
 * This is the function the rest of the codebase should call — a wallet credit,
 * a finished IMEI check, a KYC approval. Returns the notification, so a caller
 * can surface its id.
 */
const notifyUser = async (userId, { title, body, type = NOTIFICATION_TYPE.SYSTEM, data = {}, imageUrl = null }) => {
  const notification = await Notification.create({ userId, title, body, type, data, imageUrl });

  const tokens = await deviceTokenService.activeTokensForUser(userId);

  const summary = await pushToTokens(tokens, {
    title,
    body,
    imageUrl,
    // The client reads these to route the tap and to mark the row read.
    data: { ...data, type, notificationId: notification._id.toString() },
  });

  notification.pushed = summary.successCount > 0;
  notification.pushError = summary.successCount > 0 ? null : summary.error;
  await notification.save();

  return notification;
};

/**
 * Notifies many users in one pass: bulk inbox rows, then one push per device.
 *
 * `insertMany` runs unordered so a single bad row (an id that no longer exists,
 * say) does not abandon the rest of the batch — a broadcast that stops halfway
 * through the user base is far worse than one that skips a row.
 */
const notifyUsers = async (userIds, payload, { campaignId = null } = {}) => {
  const result = { delivered: 0, devices: 0, pushSuccess: 0, pushFailed: 0 };

  if (!userIds || userIds.length === 0) return result;

  const { title, body, type = NOTIFICATION_TYPE.SYSTEM, data = {}, imageUrl = null } = payload;

  const rows = userIds.map((userId) => ({
    userId,
    title,
    body,
    type,
    data,
    imageUrl,
    campaignId,
  }));

  const inserted = await Notification.insertMany(rows, { ordered: false });
  result.delivered = inserted.length;

  const tokens = await deviceTokenService.activeTokensForUsers(userIds);
  result.devices = tokens.length;

  // No per-user notificationId in the payload: this one message goes to every
  // device in the batch, and the client opens the inbox rather than a single
  // row. campaignId is enough to attribute the tap.
  const summary = await pushToTokens(tokens, {
    title,
    body,
    imageUrl,
    data: { ...data, type, ...(campaignId ? { campaignId: String(campaignId) } : {}) },
  });

  result.pushSuccess = summary.successCount;
  result.pushFailed = summary.failureCount;

  if (summary.successCount > 0) {
    await Notification.updateMany(
      { _id: { $in: inserted.map((row) => row._id) } },
      { pushed: true }
    );
  }

  return result;
};

/* ------------------------------------------------------------------ *
 * Audiences
 * ------------------------------------------------------------------ */

/**
 * Users whose registered device for a platform is behind `latestVersion`.
 *
 * Version comparison is dotted-decimal, which Mongo cannot express, so the
 * platform's tokens are read and filtered here. That is one scan of the device
 * collection per app-update send — fine at this size, and the alternative
 * (storing a sortable numeric build) is a client contract change that can come
 * later if the collection outgrows it.
 *
 * A device that never reported its version is INCLUDED: it registered before
 * the field existed, so it is old by definition.
 */
const outdatedAppUserIds = async (platform, latestVersion) => {
  const rows = await DeviceToken.find({ platform, isActive: true })
    .select('userId appVersion')
    .lean();

  const ids = rows
    .filter((row) => !row.appVersion || isOlderThan(row.appVersion, latestVersion))
    .map((row) => String(row.userId));

  return [...new Set(ids)];
};

/**
 * Turns an audience description into concrete user ids.
 *
 * Every mode is intersected with REACHABLE_USER_FILTER, so a blocked or deleted
 * account can never be reached — including via an explicit id list, where the
 * caller may simply not know the account is gone.
 */
const resolveAudience = async (audience = {}) => {
  const mode = audience.mode || AUDIENCE_MODE.ALL;

  if (mode === AUDIENCE_MODE.USER_IDS) {
    const rows = await User.find({
      _id: { $in: audience.userIds || [] },
      ...REACHABLE_USER_FILTER,
    })
      .select('_id')
      .lean();

    return rows.map((row) => String(row._id));
  }

  if (mode === AUDIENCE_MODE.OUTDATED_APP) {
    const { platform, latestVersion } = audience.filter || {};
    const candidates = await outdatedAppUserIds(platform, latestVersion);

    const rows = await User.find({ _id: { $in: candidates }, ...REACHABLE_USER_FILTER })
      .select('_id')
      .lean();

    return rows.map((row) => String(row._id));
  }

  const filter = { ...REACHABLE_USER_FILTER };

  if (mode === AUDIENCE_MODE.FILTER) {
    const given = audience.filter || {};
    if (given.userType) filter.userType = given.userType;
    if (given.kycCompleted !== undefined && given.kycCompleted !== '') {
      filter.kycCompleted = given.kycCompleted === true || given.kycCompleted === 'true';
    }
    // Only devices matter for a push, so this narrows to users who have one.
    if (given.platform) {
      const rows = await DeviceToken.find({ platform: given.platform, isActive: true })
        .select('userId')
        .lean();
      filter._id = { $in: [...new Set(rows.map((row) => String(row.userId)))] };
    }
  }

  const rows = await User.find(filter).select('_id').lean();

  return rows.map((row) => String(row._id));
};

/* ------------------------------------------------------------------ *
 * Campaigns (admin broadcasts)
 * ------------------------------------------------------------------ */

/**
 * Runs a campaign to completion, updating its stats as it goes.
 *
 * Batched so memory stays flat regardless of audience size, and wrapped so a
 * mid-run failure leaves the campaign marked FAILED with the reason rather than
 * stuck on SENDING forever.
 */
const runCampaign = async (campaign, userIds) => {
  try {
    campaign.status = CAMPAIGN_STATUS.SENDING;
    campaign.stats.targeted = userIds.length;
    await campaign.save();

    const payload = {
      title: campaign.title,
      body: campaign.body,
      type: campaign.type,
      data: campaign.data || {},
      imageUrl: campaign.imageUrl,
    };

    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);

      // eslint-disable-next-line no-await-in-loop
      const result = await notifyUsers(batch, payload, { campaignId: campaign._id });

      campaign.stats.delivered += result.delivered;
      campaign.stats.devices += result.devices;
      campaign.stats.pushSuccess += result.pushSuccess;
      campaign.stats.pushFailed += result.pushFailed;

      // Saved per batch, not just at the end, so the console can show a large
      // background send making progress instead of a frozen zero.
      // eslint-disable-next-line no-await-in-loop
      await campaign.save();
    }

    campaign.status = CAMPAIGN_STATUS.COMPLETED;
    campaign.completedAt = new Date();
    await campaign.save();
  } catch (error) {
    console.error('[Push] Campaign failed:', error.message);
    campaign.status = CAMPAIGN_STATUS.FAILED;
    campaign.error = error.message;
    campaign.completedAt = new Date();
    await campaign.save();
  }

  return campaign;
};

/**
 * Creates and dispatches a broadcast.
 *
 * Small audiences are delivered inline so the admin gets real numbers back;
 * larger ones return QUEUED immediately and finish in the background (see
 * SYNC_AUDIENCE_LIMIT). Either way the campaign document is the source of truth
 * for what happened — poll GET /admin/notifications/campaigns/:id for progress.
 */
const sendCampaign = async ({
  title,
  body,
  type = NOTIFICATION_TYPE.PROMOTIONAL,
  data = {},
  imageUrl = null,
  audience = { mode: AUDIENCE_MODE.ALL },
  adminId = null,
}) => {
  const userIds = await resolveAudience(audience);

  const campaign = await NotificationCampaign.create({
    title,
    body,
    type,
    data,
    imageUrl,
    audience: {
      mode: audience.mode || AUDIENCE_MODE.ALL,
      userIds: audience.mode === AUDIENCE_MODE.USER_IDS ? audience.userIds || [] : [],
      filter: audience.filter || {},
    },
    stats: { targeted: userIds.length },
    createdBy: adminId,
  });

  if (userIds.length <= SYNC_AUDIENCE_LIMIT) {
    await runCampaign(campaign, userIds);
    return campaign;
  }

  // Deliberately not awaited: the response goes out now and the send continues.
  // The catch is belt-and-braces — runCampaign already swallows its own errors,
  // but an unhandled rejection here would take the process down.
  runCampaign(campaign, userIds).catch((error) =>
    console.error('[Push] Background campaign crashed:', error.message)
  );

  return campaign;
};

/* ------------------------------------------------------------------ *
 * Inbox reads
 * ------------------------------------------------------------------ */

const listForUser = async (userId, { page = 1, limit = 20, unreadOnly = false, type } = {}) => {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const filter = { userId };
  if (unreadOnly === true || unreadOnly === 'true') filter.readAt = null;
  if (type) filter.type = type;

  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId, readAt: null }),
  ]);

  return {
    items,
    unreadCount: unread,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

const unreadCount = (userId) => Notification.countDocuments({ userId, readAt: null });

/**
 * Marks one notification read. Scoped to the owner, so an id guessed from
 * someone else's device cannot be touched — and a 404 (rather than a 403) keeps
 * it from confirming the row exists at all.
 */
const markRead = async (userId, notificationId) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, userId, readAt: null },
    { readAt: new Date() },
    { new: true }
  );

  if (!notification) {
    // Already read is not an error — the app marks on open and the user may tap
    // twice — so fall back to fetching it before deciding it is missing.
    const existing = await Notification.findOne({ _id: notificationId, userId });
    if (!existing) {
      throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.NOTIFICATION.NOT_FOUND);
    }
    return existing;
  }

  return notification;
};

const markAllRead = async (userId) => {
  const result = await Notification.updateMany(
    { userId, readAt: null },
    { readAt: new Date() }
  );

  return result.modifiedCount || 0;
};

const remove = async (userId, notificationId) => {
  const deleted = await Notification.findOneAndDelete({ _id: notificationId, userId });

  if (!deleted) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.NOTIFICATION.NOT_FOUND);
  }

  return deleted;
};

const listCampaigns = async ({ page = 1, limit = 20 } = {}) => {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  const [items, total] = await Promise.all([
    NotificationCampaign.find()
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    NotificationCampaign.countDocuments(),
  ]);

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

const getCampaign = async (campaignId) => {
  const campaign = await NotificationCampaign.findById(campaignId);

  if (!campaign) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.NOTIFICATION.CAMPAIGN_NOT_FOUND);
  }

  return campaign;
};

module.exports = {
  notifyUser,
  notifyUsers,
  resolveAudience,
  sendCampaign,
  runCampaign,
  listForUser,
  unreadCount,
  markRead,
  markAllRead,
  remove,
  listCampaigns,
  getCampaign,
  // Exported for tests and for the app-update sender.
  outdatedAppUserIds,
  BATCH_SIZE,
  SYNC_AUDIENCE_LIMIT,
};
