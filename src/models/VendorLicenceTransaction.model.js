const mongoose = require('mongoose');
const { VENDOR_TXN_TYPE, VENDOR_TXN_REASON, VENDOR_REF_TYPE } = require('../constants/vendorEnums');

const { Schema } = mongoose;

/**
 * Append-only ledger for vendor licence movements. Every credit (admin grant)
 * and debit (API call) writes exactly one row here. The Vendor.licences counter
 * is always reconcilable against the sum of these rows.
 *
 * `idempotencyKey` uses a sparse unique index (undefined when absent, never
 * null) so retried webhook-style calls cannot produce duplicate rows — same
 * pattern as WalletTransaction.
 *
 * `updatedAt` is intentionally absent: the schema is append-only and rows must
 * not be mutated after creation.
 */
const vendorLicenceTransactionSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    type: { type: String, enum: Object.values(VENDOR_TXN_TYPE), required: true },
    reason: { type: String, enum: Object.values(VENDOR_TXN_REASON), required: true },
    amount: { type: Number, required: true, min: 1 },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    referenceType: {
      type: String,
      enum: [...Object.values(VENDOR_REF_TYPE), null],
      default: null,
    },
    idempotencyKey: { type: String },
    adminId: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    note: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

vendorLicenceTransactionSchema.index({ vendorId: 1, createdAt: -1 });
vendorLicenceTransactionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

vendorLicenceTransactionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('VendorLicenceTransaction', vendorLicenceTransactionSchema);
