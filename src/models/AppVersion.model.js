const mongoose = require('mongoose');
const { DEVICE_PLATFORM } = require('../constants/notification');

const { Schema } = mongoose;

/**
 * The release currently published for one platform, and the oldest build still
 * allowed to run.
 *
 * One row per platform, replaced in place on every release. Lives in the
 * database rather than the environment for the same reason the settings do: a
 * force-update is exactly the lever you need on the day a broken build ships,
 * and it must not wait for a deploy.
 */
const appVersionSchema = new Schema(
  {
    platform: {
      type: String,
      enum: Object.values(DEVICE_PLATFORM),
      required: true,
      unique: true,
    },
    // What the store is serving now, e.g. "1.4.2".
    latestVersion: {
      type: String,
      required: true,
      trim: true,
    },
    // Oldest build allowed to keep working. Anything below it is forced to
    // update. Defaults to nothing, meaning "never force" — a sane default,
    // since locking users out is the destructive option.
    minSupportedVersion: {
      type: String,
      trim: true,
      default: null,
    },
    // Forces the update for anyone below latestVersion, not just below the
    // minimum. The switch to flip when a released build is actively harmful.
    mandatory: {
      type: Boolean,
      default: false,
    },
    // Shown in the update sheet. Markdown-free plain text — it renders inside
    // a native dialog on both platforms.
    releaseNotes: {
      type: String,
      trim: true,
      default: null,
    },
    // Where the update button goes. Falls back to the configured store URL for
    // the platform when unset (see services/appVersion.service.js).
    storeUrl: {
      type: String,
      trim: true,
      default: null,
    },
    releasedAt: {
      type: Date,
      default: Date.now,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

appVersionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('AppVersion', appVersionSchema);
