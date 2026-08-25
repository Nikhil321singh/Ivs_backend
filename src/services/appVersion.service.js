const AppVersion = require('../models/AppVersion.model');
const notificationService = require('./notification.service');
const env = require('../config/env');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const { compareVersions, isOlderThan } = require('../utils/version.util');
const {
  UPDATE_ACTION,
  DEVICE_PLATFORM,
  NOTIFICATION_TYPE,
  AUDIENCE_MODE,
} = require('../constants/notification');

/**
 * The app-update gate.
 *
 * The client asks "I am android 1.3.0, what should I do?" on every launch and
 * gets back one of NONE / OPTIONAL / FORCE plus what to show. Deciding this
 * server-side is the whole point: the day a build turns out to be broken you
 * need to be able to lock it out, and a rule compiled into that same broken
 * build is exactly the rule you cannot change.
 */

const storeUrlFor = (platform) =>
  platform === DEVICE_PLATFORM.IOS ? env.appUpdate.iosStoreUrl : env.appUpdate.androidStoreUrl;

const getConfig = (platform) => AppVersion.findOne({ platform });

/**
 * What a client on `currentVersion` should do.
 *
 * The order of the checks is the safety property: below the minimum supported
 * version is always FORCE, and `mandatory` escalates merely-behind to FORCE
 * too. Anything unknown — no release configured, an unparseable version string
 * — resolves to NONE, so a misconfiguration can never lock the user base out of
 * the app.
 */
const checkForUpdate = async ({ platform, currentVersion }) => {
  const config = await getConfig(platform);

  const base = {
    platform,
    currentVersion: currentVersion || null,
    updateAvailable: false,
    updateAction: UPDATE_ACTION.NONE,
    forceUpdate: false,
    latestVersion: null,
    minSupportedVersion: null,
    releaseNotes: null,
    storeUrl: storeUrlFor(platform),
  };

  if (!config) return base;

  const result = {
    ...base,
    latestVersion: config.latestVersion,
    minSupportedVersion: config.minSupportedVersion,
    releaseNotes: config.releaseNotes,
    storeUrl: config.storeUrl || storeUrlFor(platform),
    releasedAt: config.releasedAt,
  };

  // No version from the client means we cannot judge it. Offer the update
  // rather than force it — an old client that predates this endpoint would
  // otherwise be bricked by its own missing field.
  if (!currentVersion) {
    result.updateAvailable = true;
    result.updateAction = UPDATE_ACTION.OPTIONAL;
    return result;
  }

  const behindLatest = compareVersions(currentVersion, config.latestVersion) < 0;

  if (!behindLatest) return result;

  result.updateAvailable = true;

  const belowMinimum =
    !!config.minSupportedVersion && isOlderThan(currentVersion, config.minSupportedVersion);

  result.updateAction =
    belowMinimum || config.mandatory ? UPDATE_ACTION.FORCE : UPDATE_ACTION.OPTIONAL;
  result.forceUpdate = result.updateAction === UPDATE_ACTION.FORCE;

  return result;
};

/**
 * Publishes (or edits) the release for one platform.
 *
 * Refuses a minimum above the latest version: that combination forces every
 * user — including those on the newest build — into an update wall with nothing
 * to update to, which is unrecoverable without database access. Better to
 * reject the save than to let one typo take the app down.
 */
const upsertConfig = async (platform, patch, adminId = null) => {
  const existing = await getConfig(platform);

  const next = {
    latestVersion: patch.latestVersion ?? (existing && existing.latestVersion),
    minSupportedVersion:
      patch.minSupportedVersion !== undefined
        ? patch.minSupportedVersion || null
        : existing && existing.minSupportedVersion,
    mandatory:
      patch.mandatory !== undefined ? !!patch.mandatory : !!(existing && existing.mandatory),
    releaseNotes:
      patch.releaseNotes !== undefined
        ? patch.releaseNotes || null
        : existing && existing.releaseNotes,
    storeUrl:
      patch.storeUrl !== undefined ? patch.storeUrl || null : existing && existing.storeUrl,
  };

  if (!next.latestVersion) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.APP_VERSION.LATEST_REQUIRED);
  }

  if (next.minSupportedVersion && compareVersions(next.minSupportedVersion, next.latestVersion) > 0) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.APP_VERSION.MIN_ABOVE_LATEST);
  }

  const config = await AppVersion.findOneAndUpdate(
    { platform },
    {
      platform,
      ...next,
      // Only stamp a new release date when the published version actually
      // changed — editing release notes is not a release.
      ...(!existing || existing.latestVersion !== next.latestVersion
        ? { releasedAt: new Date() }
        : {}),
      updatedBy: adminId,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return config;
};

const listConfigs = () => AppVersion.find().sort({ platform: 1 });

/**
 * Pushes "a new version is available" to exactly the people who need it —
 * users whose registered device on this platform is behind the published
 * release. Nobody already up to date is nagged.
 *
 * The `data` block is what makes the notification actionable: tapping it hands
 * the app the store URL and whether the update is forced, so it can open the
 * store or raise the update wall without a second round trip.
 */
const notifyOutdatedUsers = async ({ platform, title, body, adminId = null }) => {
  const config = await getConfig(platform);

  if (!config) {
    throw new ApiError(httpStatus.NOT_FOUND, MESSAGES.APP_VERSION.NOT_CONFIGURED);
  }

  const campaign = await notificationService.sendCampaign({
    title: title || MESSAGES.APP_VERSION.UPDATE_TITLE,
    body:
      body ||
      (config.releaseNotes
        ? `Version ${config.latestVersion} is out. ${config.releaseNotes}`
        : `Version ${config.latestVersion} is out. Update now for the latest features and fixes.`),
    type: NOTIFICATION_TYPE.APP_UPDATE,
    data: {
      screen: 'AppUpdate',
      platform,
      latestVersion: config.latestVersion,
      minSupportedVersion: config.minSupportedVersion,
      storeUrl: config.storeUrl || storeUrlFor(platform),
      forceUpdate: config.mandatory,
    },
    audience: {
      mode: AUDIENCE_MODE.OUTDATED_APP,
      filter: { platform, latestVersion: config.latestVersion },
    },
    adminId,
  });

  return { campaign, config };
};

module.exports = {
  checkForUpdate,
  getConfig,
  listConfigs,
  upsertConfig,
  notifyOutdatedUsers,
  storeUrlFor,
};
