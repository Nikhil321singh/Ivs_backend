const mongoose = require('mongoose');

const { Schema } = mongoose;

const SESSION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SCANNED: 'SCANNED',
  COMPLETED: 'COMPLETED',
  EXPIRED: 'EXPIRED',
});

const blanccoSessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    sessionToken: {
      type: String,
      required: true,
      unique: true,
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    customerPhone: {
      type: String,
      required: true,
      trim: true,
    },
    customerEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    customerAadhaarNumber: {
      type: String,
      trim: true,
      default: null,
    },
    imei: {
      type: String,
      trim: true,
      default: null,
    },
    deviceModel: {
      type: String,
      trim: true,
      default: null,
    },
    deviceBrand: {
      type: String,
      trim: true,
      default: null,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(SESSION_STATUS),
      default: SESSION_STATUS.PENDING,
    },
    qrData: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    scannedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

blanccoSessionSchema.index({ userId: 1, createdAt: -1 });
blanccoSessionSchema.index({ userId: 1, imei: 1 });
blanccoSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

blanccoSessionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

const BlanccoSession = mongoose.model('BlanccoSession', blanccoSessionSchema);
BlanccoSession.SESSION_STATUS = SESSION_STATUS;

module.exports = BlanccoSession;
