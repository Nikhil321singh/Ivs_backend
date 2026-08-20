const DeviceToken = require('../models/DeviceToken.model');

/* eslint-disable no-console */

/**
 * The registry of app installations we can push to.
 *
 * Everything here is idempotent by design: the client re-registers its FCM
 * token on every launch (and whenever Firebase rotates it), so registration has
 * to converge on one row rather than accumulate them.
 */

/**
 * Upserts the caller's device token.
 *
 * Keyed on the token because that is what FCM addresses. If the token already
 * belongs to a DIFFERENT user, ownership moves to the caller — the same handset
 * after a sign-out/sign-in — which is what stops the previous account's
 * notifications from landing on a phone they no longer hold.
 */
const register = async (userId, { token, platform, appVersion, deviceId, deviceModel, osVersion }) => {
  const device = await DeviceToken.findOneAndUpdate(
    { token },
    {
      userId,
      token,
      platform,
      appVersion: appVersion || null,
      deviceId: deviceId || null,
      deviceModel: deviceModel || null,
      osVersion: osVersion || null,
      isActive: true,
      inactiveReason: null,
      lastSeenAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return device;
};

/**
 * Retires one token — call on sign-out, so the next person to use the handset
 * does not receive the previous user's notifications.
 *
 * Scoped to the owning user: a token is guessable in the sense that it travels
 * through the client, and without this scope any authenticated caller could
 * silence another user's device.
 */
const deactivate = async (userId, token) => {
  const result = await DeviceToken.updateOne(
    { userId, token },
    { isActive: false, inactiveReason: 'LOGOUT' }
  );

  return result.modifiedCount > 0;
};

/** Retires every device for a user (account deletion, forced sign-out). */
const deactivateAllForUser = async (userId, reason = 'LOGOUT') => {
  const result = await DeviceToken.updateMany(
    { userId, isActive: true },
    { isActive: false, inactiveReason: reason }
  );

  return result.modifiedCount || 0;
};

/**
 * Retires tokens FCM told us are dead (uninstalled app, rotated token).
 *
 * Deactivated rather than deleted so a reinstall reactivates the same row, and
 * so "this user had 3 devices and all went quiet" stays visible.
 */
const retireInvalidTokens = async (tokens = []) => {
  if (tokens.length === 0) return 0;

  const result = await DeviceToken.updateMany(
    { token: { $in: tokens } },
    { isActive: false, inactiveReason: 'UNREGISTERED' }
  );

  if (result.modifiedCount) {
    console.warn(`[Push] Retired ${result.modifiedCount} device token(s) reported dead by FCM.`);
  }

  return result.modifiedCount || 0;
};

/** Live registration tokens for one user. */
const activeTokensForUser = async (userId) => {
  const rows = await DeviceToken.find({ userId, isActive: true }).select('token').lean();
  return rows.map((row) => row.token);
};

/**
 * Live tokens for many users at once, as a flat list.
 *
 * Batched deliberately: a broadcast resolves its audience in pages, and one
 * query per user would turn a 5,000-user send into 5,000 round trips.
 */
const activeTokensForUsers = async (userIds) => {
  if (!userIds || userIds.length === 0) return [];

  const rows = await DeviceToken.find({ userId: { $in: userIds }, isActive: true })
    .select('token')
    .lean();

  return rows.map((row) => row.token);
};

/** The caller's own registered devices, for a "signed-in devices" screen. */
const listForUser = (userId) =>
  DeviceToken.find({ userId, isActive: true }).sort({ lastSeenAt: -1 });

module.exports = {
  register,
  deactivate,
  deactivateAllForUser,
  retireInvalidTokens,
  activeTokensForUser,
  activeTokensForUsers,
  listForUser,
};
