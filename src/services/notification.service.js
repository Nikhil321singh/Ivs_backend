const DeviceToken = require('../models/DeviceToken.model');
const provider = require('./providers/fcmProvider');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

/**
 * Registers (or reassigns) a device's FCM token to this user. Upserting on
 * `token` rather than inserting means a re-login on the same device updates
 * ownership instead of creating a duplicate row, and a re-registration from
 * the same user is a harmless no-op.
 */
const registerDeviceToken = async (userId, { token, platform }) => {
  await DeviceToken.findOneAndUpdate(
    { token },
    { userId, token, ...(platform && { platform }) },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/** Unregisters a device token, e.g. on logout. Scoped to the caller's own token. */
const removeDeviceToken = async (userId, token) => {
  await DeviceToken.deleteOne({ token, userId });
};

/**
 * Sends a push notification to every device registered to `userId`. Dead
 * tokens FCM reports as invalid/unregistered are pruned from the DB so they
 * don't keep getting (and failing) sends.
 */
const sendToUser = async (userId, { title, body, data } = {}) => {
  if (!provider.isConfigured()) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, MESSAGES.NOTIFICATION.NOT_CONFIGURED);
  }

  const deviceTokens = await DeviceToken.find({ userId }).lean();
  if (deviceTokens.length === 0) {
    return { sent: 0, failed: 0, devices: 0 };
  }

  const tokens = deviceTokens.map((d) => d.token);
  const result = await provider.sendToTokens(tokens, { title, body }, data);

  if (result.invalidTokens.length > 0) {
    await DeviceToken.deleteMany({ token: { $in: result.invalidTokens } });
  }

  return { sent: result.successCount, failed: result.failureCount, devices: tokens.length };
};

module.exports = { registerDeviceToken, removeDeviceToken, sendToUser };
