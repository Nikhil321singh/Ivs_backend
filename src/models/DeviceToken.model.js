const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * A single device's FCM registration token. One row per physical device —
 * `token` is globally unique (FCM issues a fresh token per app install), so
 * registering the same token again just reassigns it to whichever user is
 * currently logged in on that device rather than creating a duplicate.
 */
const PLATFORM = Object.freeze({
  ANDROID: 'ANDROID',
  IOS: 'IOS',
  WEB: 'WEB',
});

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
      unique: true,
    },
    platform: {
      type: String,
      enum: Object.values(PLATFORM),
      default: PLATFORM.ANDROID,
    },
  },
  { timestamps: true }
);

deviceTokenSchema.index({ userId: 1 });

deviceTokenSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);
DeviceToken.PLATFORM = PLATFORM;

module.exports = DeviceToken;
