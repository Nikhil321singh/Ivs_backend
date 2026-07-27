// KYC identity type. A vendor is identified by GST (no Aadhaar); an
// individual is identified by Aadhaar (no GST). Set at /user/complete-kyc.
const USER_TYPE = Object.freeze({
  VENDOR: 'vendor',
  INDIVIDUAL: 'individual',
});

module.exports = USER_TYPE;
