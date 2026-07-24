const mongoose = require('mongoose');

const { Schema } = mongoose;

const refreshTokenSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    refreshToken: {
      // SHA-256 hash of the issued refresh token (see utils/hash.util.js).
      // The plaintext token is only ever returned to the client, never stored.
      type: String,
      required: true,
    },
    deviceId: {
      type: String,
      required: true,
      trim: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    isRevoked: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// One active session document per user per device — refresh rotation upserts this.
refreshTokenSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

// MongoDB TTL index: expired sessions are purged automatically without a
// separate cron/worker process.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
