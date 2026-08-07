const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * Runtime-editable settings, one row per key. Lives in the database rather than
 * the environment so an operator can flip a switch from the admin portal without
 * a deploy or a PM2 restart.
 *
 * Defaults live in constants/settings.js — a key absent from this collection
 * means "still on its default", so a fresh database needs no seeding.
 */
const settingSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    value: {
      type: Schema.Types.Mixed,
      required: true,
    },
    // Audit trail: who last changed this and when.
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

module.exports = mongoose.model('Setting', settingSchema);
