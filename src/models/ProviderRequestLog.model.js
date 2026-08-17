const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * Append-only record of every SprintVerify/DigiLocker call we make.
 *
 * Exists for billing reconciliation: the provider bills on HTTP status, not on
 * whether the call was useful to us — 200 and 422 are billable, 201 is not. A
 * row is written for every attempt, including failures, because a failed call
 * can still be chargeable and an invoice dispute needs the full picture.
 *
 * Deliberately stores no request or response bodies: those carry Aadhaar data.
 * Only the routing facts needed to reconcile an invoice are kept.
 */
const providerRequestLogSchema = new Schema(
  {
    provider: {
      type: String,
      required: true,
      default: 'DIGILOCKER',
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    refid: {
      type: String,
      required: true,
    },
    operation: {
      type: String,
      required: true,
    },
    // HTTP status the provider returned; null when the request never completed
    // (timeout, DNS, connection reset) — which is also never billable.
    providerStatus: {
      type: Number,
      default: null,
    },
    billable: {
      type: Boolean,
      required: true,
      default: false,
    },
    // Short provider message, kept for support. Never a full response body.
    providerMessage: {
      type: String,
      default: null,
    },
    durationMs: {
      type: Number,
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

providerRequestLogSchema.index({ refid: 1, createdAt: -1 });
providerRequestLogSchema.index({ userId: 1, createdAt: -1 });
providerRequestLogSchema.index({ billable: 1, createdAt: -1 });

module.exports = mongoose.model('ProviderRequestLog', providerRequestLogSchema);
