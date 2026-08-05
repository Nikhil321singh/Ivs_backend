const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * A single device-diagnosis run against the third-party diagnose provider.
 * Mirrors ImeiVerificationLog: it logs every attempt and its outcome. Billing
 * keys off `resultStatus` — only a SUCCESS is chargeable (see
 * services/diagnose.service.js); ERROR/UNKNOWN runs are free retries.
 */
const RESULT_STATUS = Object.freeze({
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
  UNKNOWN: 'UNKNOWN',
});

const SESSION_STATUS = Object.freeze({
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

const diagnoseSessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    input: {
      type: Schema.Types.Mixed,
      default: null,
    },
    providerRefId: {
      type: String,
      default: null,
    },
    resultStatus: {
      type: String,
      enum: Object.values(RESULT_STATUS),
      required: true,
    },
    result: {
      type: Schema.Types.Mixed,
      default: null,
    },
    rawResponse: {
      type: Schema.Types.Mixed,
      default: null,
    },
    chargeTxnId: {
      type: Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(SESSION_STATUS),
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

diagnoseSessionSchema.index({ userId: 1, createdAt: -1 });

diagnoseSessionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

const DiagnoseSession = mongoose.model('DiagnoseSession', diagnoseSessionSchema);
DiagnoseSession.RESULT_STATUS = RESULT_STATUS;
DiagnoseSession.SESSION_STATUS = SESSION_STATUS;

module.exports = DiagnoseSession;
