/**
 * Creates (or updates the password of) an admin portal account.
 *
 *   ADMIN_EMAIL=admin@grest.in ADMIN_PASSWORD='...' node scripts/seed-admin.js
 *   npm run seed:admin
 *
 * With no ADMIN_PASSWORD set, a strong random password is generated and printed
 * once — copy it before closing the terminal, it is never stored in the clear.
 *
 * Re-running for an existing email resets that admin's password rather than
 * failing, which makes it the recovery path for a lost login.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const env = require('../src/config/env');
const Admin = require('../src/admin/models/Admin.model');
const { hashPassword } = require('../src/admin/utils/password.util');

const EMAIL = (process.env.ADMIN_EMAIL || 'admin@grest.in').toLowerCase().trim();
const NAME = process.env.ADMIN_NAME || 'Administrator';

// base64url of 18 bytes — 24 characters, no ambiguous shell-quoting characters.
const generatePassword = () => crypto.randomBytes(18).toString('base64url');

const seed = async () => {
  const password = process.env.ADMIN_PASSWORD || generatePassword();
  const generated = !process.env.ADMIN_PASSWORD;

  await mongoose.connect(env.mongodbUri);

  const passwordHash = await hashPassword(password);
  const existing = await Admin.findOne({ email: EMAIL });

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.isActive = true;
    await existing.save();
  } else {
    await Admin.create({ email: EMAIL, passwordHash, name: NAME });
  }

  /* eslint-disable no-console */
  console.log('');
  console.log(existing ? 'Password reset for existing admin.' : 'Admin account created.');
  console.log('  Portal:   ' + env.apiBaseUrl + '/admin');
  console.log('  Email:    ' + EMAIL);
  if (generated) {
    console.log('  Password: ' + password);
    console.log('');
    console.log('  ^ Shown once. Store it in your password manager now.');
  } else {
    console.log('  Password: (the ADMIN_PASSWORD you supplied)');
  }
  console.log('');
  /* eslint-enable no-console */

  await mongoose.disconnect();
};

seed().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error('Admin seed failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
