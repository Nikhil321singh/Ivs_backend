const mongoose = require('mongoose');

const cdotTransactionSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CDOTVendor',
      required: true,
    },
    type: {
      type: String,
      enum: ['DEBIT', 'CREDIT'],
      required: true,
    },
    amountPaise: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      enum: ['CDOT_CHECK', 'TOP_UP', 'ADMIN_ADJUSTMENT', 'REFUND'],
      required: true,
    },
    balanceBefore: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    reference: {
      type: String,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

module.exports = mongoose.model('CDOTTransaction', cdotTransactionSchema);
