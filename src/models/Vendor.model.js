const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * One document per third-party vendor that calls the /wrapper/check-imei
 * endpoint. Separate from the User collection — no amount of privilege on a
 * User document can grant vendor API access.
 *
 * `licences` is a cached counter; the authoritative record is the
 * VendorLicenceTransaction ledger. All mutations go through
 * services/vendorLicence.service.js, which uses conditional $inc so a counter
 * can never go negative.
 *
 * `apiKeyHash` is the SHA-256 of the raw key. The raw key is generated once at
 * creation time and returned once — it is never stored in plain text.
 */
const vendorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    apiKeyHash: { type: String, required: true, unique: true, select: false },
    licences: { type: Number, default: 0, min: 0 },
    totalGranted: { type: Number, default: 0 },
    totalUsed: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

vendorSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.apiKeyHash;
    return ret;
  },
});

module.exports = mongoose.model('Vendor', vendorSchema);
