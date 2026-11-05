/* One-off local seed: create (or reuse) a test vendor and print its raw API key.
   Run: node scripts/seed-vendor.js */
const crypto = require('crypto');
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const Vendor = require('../src/models/Vendor.model');
const { hashApiKey, credit } = require('../src/services/vendorLicence.service');

const EMAIL = 'test@vendor.com';
const RAW_KEY = 'ivs_test_local_dev_key_0001';

(async () => {
  await connectDB();

  let vendor = await Vendor.findOne({ email: EMAIL });
  if (!vendor) {
    vendor = await Vendor.create({
      name: 'Test Vendor',
      email: EMAIL,
      apiKeyHash: hashApiKey(RAW_KEY),
    });
    await credit(vendor._id, 100, { note: 'Initial test grant' });
    console.log('Created vendor + granted 100 licences.');
  } else {
    // Make sure the known key still maps here, and there are licences to show.
    await Vendor.updateOne({ _id: vendor._id }, { apiKeyHash: hashApiKey(RAW_KEY) });
    if (vendor.licences < 1) await credit(vendor._id, 100, { note: 'Top-up for testing' });
    console.log('Reused existing vendor.');
  }

  console.log('\nAPI key (paste into the portal login):\n  ' + RAW_KEY + '\n');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
