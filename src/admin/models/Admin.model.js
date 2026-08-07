const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * Portal operators. Deliberately a separate collection from User: admins sign
 * in with email + password (no SMS round trip, so the portal keeps working when
 * MSG91 is down), and no amount of privilege confusion on a User document can
 * grant admin access.
 */
const adminSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    // scrypt digest — see utils/password.util.js. `select: false` so the hash
    // never leaves the database by accident on a plain find().
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    name: {
      type: String,
      trim: true,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

adminSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = mongoose.model('Admin', adminSchema);
