const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * A vendor's own record of a diagnosis they performed for a walk-in customer:
 * who the device belonged to, what the report said, and what they charged.
 *
 * Deliberately separate from DiagnoseSession. That model logs a *provider* run
 * and the tokens it cost; this one is bookkeeping the vendor fills in and owns.
 * Nothing here touches the wallet — `price` is rupees the vendor billed their
 * customer, not tokens, so the two numbers must never be conflated in reporting.
 *
 * Aadhaar is stored MASKED only ("XXXXXXXX1234"), never in full — the same rule
 * the User model follows, applied here because this is someone else's Aadhaar,
 * where the case for not holding it is stronger still. The service masks on the
 * way in, so a full number can't reach this collection even if a caller sends one.
 */
const diagnoseRecordSchema = new Schema(
  {
    // The vendor who performed and recorded the diagnosis (the logged-in user).
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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
    // Masked display value only — see the note above.
    customerAadhaarNumber: {
      type: String,
      trim: true,
      default: null,
    },
    // The device the diagnosis was run on. Optional: a vendor may record a
    // job before the handset is in front of them, and some devices (tablets,
    // wearables) have no IMEI at all. Stored as the plain 15-digit string —
    // unlike Aadhaar it is a device identifier, not a person's, so the masking
    // rule above does not apply.
    imei: {
      type: String,
      trim: true,
      default: null,
    },
    // Free-text model name as the vendor wrote it ("iPhone 13 Pro", "Redmi
    // Note 12"). Not validated against any device catalogue — there isn't one
    // here, and a wrong-but-readable label beats a rejected record.
    deviceModel: {
      type: String,
      trim: true,
      default: null,
    },
    // The diagnosis itself. Mixed so a caller can store either a plain text
    // summary or the structured result a diagnosis tool produced, without this
    // schema having to track that tool's shape.
    report: {
      type: Schema.Types.Mixed,
      required: true,
    },
    // Rupees charged to the customer. Not tokens.
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    // When the diagnosis was actually performed, which can predate when it was
    // recorded — a vendor may enter yesterday's jobs this morning. Defaults to
    // now when the caller doesn't say; `createdAt` remains the write time.
    diagnosedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Serves both the history listing and its count, which always filter by userId.
diagnoseRecordSchema.index({ userId: 1, diagnosedAt: -1 });

// Looking a customer's device up by IMEI is the other way a vendor reaches a
// record ("this handset was here before"), so it gets its own compound index
// rather than riding the diagnosedAt one, which cannot serve an imei equality.
diagnoseRecordSchema.index({ userId: 1, imei: 1 });

diagnoseRecordSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('DiagnoseRecord', diagnoseRecordSchema);
