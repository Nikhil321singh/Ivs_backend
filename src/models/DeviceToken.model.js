const mongoose = require('mongoose');
const { DEVICE_PLATFORM } = require('../constants/notification');

const { Schema } = mongoose;

/**
 * One row per app installation: the FCM registration token plus enough device
 * context to answer "which of my users are still on the old build?".
 *
 * The token — not (user, device) — is the identity here, because that is what
 * FCM addresses. It carries a unique index so re-registering is an upsert: the
 * app re-sends its token on every launch, and without that we would accumulate
 * a row per launch and push the same notification a dozen times to one phone.
 *
 * A token can legitimately move between users (someone signs out and a
 * colleague signs in on the same handset). Registration reassigns `userId`
 * rather than creating a second row, so the previous account stops receiving
 * notifications on a device that is no longer theirs.
 */
const deviceTokenSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    token: {
      type: String,
      required: true,
      trim: true,
    },
    platform: {
      type: String,
      enum: Object.values(DEVICE_PLATFORM),
      required: true,
    },
    // The app build this token last checked in from. Drives the "outdated app"
    // audience, so an update notice only reaches people who need it.
    appVersion: {
      type: String,
      trim: true,
      default: null,
    },
    // Client-generated install id. Not the identity (the token is), but useful
    // for support: it survives a token rotation, so it is how you tell "the
    // same phone" from "a new phone".
    deviceId: {
      type: String,
      trim: true,
      default: null,
    },
    deviceModel: {
      type: String,
      trim: true,
      default: null,
    },
    osVersion: {
      type: String,
      trim: true,
      default: null,
    },
    // Set false rather than deleting the row when the user signs out or FCM
    // reports the token as dead — keeping the row means a re-registration
    // reactivates it in place, and the history stays auditable.
    isActive: {
      type: Boolean,
      default: true,
    },
    // Why it was deactivated: 'LOGOUT', 'UNREGISTERED', 'REPLACED'.
    inactiveReason: {
      type: String,
      default: null,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

deviceTokenSchema.index({ token: 1 }, { unique: true });
// The delivery query: every live token for a user.
deviceTokenSchema.index({ userId: 1, isActive: 1 });
// The audience query: live tokens on one platform, filtered by build.
deviceTokenSchema.index({ platform: 1, isActive: 1 });

deviceTokenSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    // The registration token is a delivery credential: anyone holding it can
    // push to that device via our project. It never leaves the server.
    delete ret.token;
    return ret;
  },
});

module.exports = mongoose.model('DeviceToken', deviceTokenSchema);
