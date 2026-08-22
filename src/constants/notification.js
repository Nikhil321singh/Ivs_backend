/**
 * Push notification and app-update vocabulary.
 *
 * One place for every enum the notification stack stores or returns, so a
 * client can switch on `type` / `updateAction` without matching free strings
 * that drift between the model, the service and the admin console.
 */

/**
 * What a notification is ABOUT. The mobile app uses this to pick an icon, a
 * destination screen and (on Android) a notification channel, so add a new
 * value here rather than overloading an existing one.
 */
const NOTIFICATION_TYPE = Object.freeze({
  // A newer build is available. Carries the version payload in `data` so the
  // app can deep-link straight to the store listing.
  APP_UPDATE: 'APP_UPDATE',
  // Offers, campaigns, announcements — anything the user may opt out of.
  PROMOTIONAL: 'PROMOTIONAL',
  // Something happened on the user's own account (top-up credited, IMEI check
  // finished). Never suppressed by a marketing opt-out.
  TRANSACTIONAL: 'TRANSACTIONAL',
  WALLET: 'WALLET',
  KYC: 'KYC',
  IVS: 'IVS',
  // Operational notices: maintenance windows, policy changes.
  SYSTEM: 'SYSTEM',
});

/** Where a device token came from. Lowercase to match what the clients send. */
const DEVICE_PLATFORM = Object.freeze({
  ANDROID: 'android',
  IOS: 'ios',
  WEB: 'web',
});

/**
 * What the app must DO about its version, decided server-side so the rule can
 * change without a release:
 *   NONE     — up to date, show nothing
 *   OPTIONAL — offer the update, let the user dismiss it
 *   FORCE    — block the app behind an update wall (build is below the minimum
 *              supported version, or the release was marked mandatory)
 */
const UPDATE_ACTION = Object.freeze({
  NONE: 'NONE',
  OPTIONAL: 'OPTIONAL',
  FORCE: 'FORCE',
});

/** How an admin broadcast picks its recipients. */
const AUDIENCE_MODE = Object.freeze({
  // Every non-deleted, non-blocked user.
  ALL: 'ALL',
  // An explicit list of user ids.
  USER_IDS: 'USER_IDS',
  // A profile filter (kycCompleted, userType, status).
  FILTER: 'FILTER',
  // Only users whose registered device for a platform is behind the latest
  // release — used by the app-update push so nobody is nagged to install a
  // version they already run.
  OUTDATED_APP: 'OUTDATED_APP',
});

const CAMPAIGN_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

module.exports = {
  NOTIFICATION_TYPE,
  DEVICE_PLATFORM,
  UPDATE_ACTION,
  AUDIENCE_MODE,
  CAMPAIGN_STATUS,
};
