const mongoose = require('mongoose');
const {
  NOTIFICATION_TYPE,
  AUDIENCE_MODE,
  CAMPAIGN_STATUS,
} = require('../constants/notification');

const { Schema } = mongoose;

/**
 * One admin broadcast: what was sent, to whom, and how it went.
 *
 * Exists so a send is answerable after the fact. Without it the only evidence a
 * broadcast happened is thousands of near-identical inbox rows, and there is no
 * way to tell "reached 8,000 users" from "FCM rejected 8,000 stale tokens".
 */
const notificationCampaignSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPE),
      default: NOTIFICATION_TYPE.PROMOTIONAL,
    },
    imageUrl: { type: String, default: null },
    data: { type: Schema.Types.Mixed, default: {} },

    audience: {
      mode: {
        type: String,
        enum: Object.values(AUDIENCE_MODE),
        default: AUDIENCE_MODE.ALL,
      },
      // Populated for USER_IDS. Kept so a targeted send can be reviewed later.
      userIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      // Populated for FILTER / OUTDATED_APP: the criteria as given.
      filter: { type: Schema.Types.Mixed, default: {} },
    },

    stats: {
      // Users the audience resolved to.
      targeted: { type: Number, default: 0 },
      // Inbox rows written — equal to `targeted` unless a write failed.
      delivered: { type: Number, default: 0 },
      // Device tokens the push was attempted on. Higher than `delivered` when
      // users have several devices, lower when they have none registered.
      devices: { type: Number, default: 0 },
      pushSuccess: { type: Number, default: 0 },
      pushFailed: { type: Number, default: 0 },
    },

    status: {
      type: String,
      enum: Object.values(CAMPAIGN_STATUS),
      default: CAMPAIGN_STATUS.QUEUED,
    },
    // Set when the run itself failed (not when individual pushes did).
    error: { type: String, default: null },
    completedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  {
    timestamps: true,
  }
);

notificationCampaignSchema.index({ createdAt: -1 });

notificationCampaignSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('NotificationCampaign', notificationCampaignSchema);
