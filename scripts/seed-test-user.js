/**
 * Seeds a ready-to-use test account so QA can skip signup and KYC entirely.
 *
 *   node scripts/seed-test-user.js
 *   MOBILE=9999888877 node scripts/seed-test-user.js
 *
 * Creates (or refreshes) an individual user with mobile verified, Aadhaar
 * verified and KYC completed. PAN and Aadhaar are randomly generated in valid
 * formats, so re-running never collides on the unique indexes.
 *
 * Idempotent: if the mobile already exists the existing row is updated in
 * place rather than duplicated (countryCode+mobile is a unique index).
 *
 * Login still goes through the normal mobile-OTP flow — this script does not
 * bypass MSG91, it only removes the onboarding steps that follow it.
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User.model');
const referralService = require('../src/services/referral.service');
const { hashAadhaar } = require('../src/utils/hash.util');
const USER_STATUS = require('../src/constants/userStatus');
const USER_TYPE = require('../src/constants/userType');

const NAME = process.env.NAME || 'Test';
const MOBILE = process.env.MOBILE || '9717753079';

const randomInt = (max) => Math.floor(Math.random() * max);
const randomLetters = (count) =>
  Array.from({ length: count }, () => String.fromCharCode(65 + randomInt(26))).join('');
const randomDigits = (count) =>
  Array.from({ length: count }, () => randomInt(10)).join('');

// PAN_REGEX in validators/user.validator.js: 5 letters, 4 digits, 1 letter.
const randomPan = () => `${randomLetters(5)}${randomDigits(4)}${randomLetters(1)}`;

// AADHAAR_REGEX: 12 digits, first in 2-9. Random rather than the sandbox
// number so this account is independent of AADHAAR_TEST_MODE.
const randomAadhaar = () => `${2 + randomInt(8)}${randomDigits(11)}`;

const maskAadhaar = (aadhaarNumber) => `XXXXXXXX${aadhaarNumber.slice(-4)}`;

const seed = async () => {
  await mongoose.connect(env.mongodbUri);

  const aadhaarNumber = randomAadhaar();
  const panNumber = randomPan();

  const existing = await User.findOne({ countryCode: env.defaultCountryCode, mobile: MOBILE });
  const user = existing || new User({ countryCode: env.defaultCountryCode, mobile: MOBILE });

  if (!user.referralCode) {
    user.referralCode = await referralService.generateUniqueReferralCode();
  }

  user.name = NAME;
  user.userType = USER_TYPE.INDIVIDUAL;
  user.phone = MOBILE;
  // Unique per run so repeated seeding never trips the sparse unique index.
  user.email = `test+${Date.now()}@example.com`;
  user.panNumber = panNumber;
  user.isGstRegistered = false;
  user.gstNumber = undefined;
  user.aadhaarNumber = maskAadhaar(aadhaarNumber);
  // Random number is never in AADHAAR_TEST_NUMBERS, so this is the plain
  // unsalted hash — same as a real verification would store.
  user.aadhaarNumberHash = hashAadhaar(aadhaarNumber, user._id);
  user.aadhaarVerified = true;
  user.isMobileVerified = true;
  user.kycCompleted = true;
  user.status = USER_STATUS.ACTIVE;

  await user.save();

  /* eslint-disable no-console */
  console.log(existing ? 'Updated existing test user:' : 'Created test user:');
  console.log({
    id: user._id.toString(),
    name: user.name,
    mobile: `${user.countryCode}${user.mobile}`,
    email: user.email,
    panNumber: user.panNumber,
    aadhaarNumber: user.aadhaarNumber,
    aadhaarFull: aadhaarNumber, // shown once — only the masked form is stored
    referralCode: user.referralCode,
    kycCompleted: user.kycCompleted,
  });
  /* eslint-enable no-console */

  await mongoose.disconnect();
};

// Only auto-run when invoked directly, so the generators above can be required
// and exercised without opening a database connection.
if (require.main === module) {
  seed().catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = { seed, randomPan, randomAadhaar, maskAadhaar };
