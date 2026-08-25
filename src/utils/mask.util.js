/**
 * Display-only masking for identity numbers.
 *
 * Aadhaar is never persisted in full anywhere in this system — the User model
 * stores a masked value plus a hash for uniqueness, and customer-facing records
 * store the mask alone. Keeping the mask here means every caller produces the
 * same shape, so a masked value written by one flow is comparable to one
 * written by another.
 */
const maskAadhaar = (aadhaarNumber) => `XXXXXXXX${String(aadhaarNumber).slice(-4)}`;

module.exports = { maskAadhaar };
