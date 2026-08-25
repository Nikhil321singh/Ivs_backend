const mongoose = require('mongoose');
const { NOTIFICATION_TYPE } = require('../constants/notification');

const { Schema } = mongoose;

/**
 * A user's in-app notification inbox.
 *
 * Written for EVERY notification, whether or not the push itself succeeded. A
 * push is best-effort — the phone may be off, the token stale, FCM down — so
 * the inbox, not FCM, is the record of what the user was told. This is also
 * what makes an unread badge possible at all.
 */
const notificationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPE),
      default: NOTIFICATION_TYPE.SYSTEM,
    },
    imageUrl: {
      type: String,
      default: null,
    },
    // Free-form routing payload handed to the client verbatim — e.g.
    // { screen: 'WalletScreen', orderId: '...' } or the app-update block.
    // Mixed on purpose: this is a client contract, not a server one, and
    // pinning a schema here would mean a migration every time the app adds a
    // deep link.
    data: {
      type: Schema.Types.Mixed,
      default: {},
    },
    // Set when this row came from an admin broadcast, so the console can show
    // "delivered to N users" for a campaign and drill into it.
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: 'NotificationCampaign',
      default: null,
    },
    readAt: {
      type: Date,
      default: null,
    },
    // Push outcome, recorded for support ("they say they never got it").
    pushed: {
      type: Boolean,
      default: false,
    },
    pushError: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// The inbox query: one user's notifications, newest first.
notificationSchema.index({ userId: 1, createdAt: -1 });
// The badge query: unread rows only (partial, so the index stays small — most
// rows end up read, and they are dead weight in this index).
notificationSchema.index(
  { userId: 1, readAt: 1 },
  { partialFilterExpression: { readAt: null } }
);
notificationSchema.index({ campaignId: 1 });

notificationSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    // Convenience for the client: the one thing every inbox UI needs and would
    // otherwise recompute from readAt on every row.
    ret.isRead = !!ret.readAt;
    return ret;
  },
});

module.exports = mongoose.model('Notification', notificationSchema);
