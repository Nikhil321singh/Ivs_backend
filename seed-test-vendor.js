// One-off: upsert a test API vendor with a KNOWN key so the /api-vendor portal
// can be tested locally. Run from backend root: node seed-test-vendor.js
require('dotenv').config();
const crypto = require('crypto');
const connectDB = require('./src/config/database');
const Vendor = require('./src/models/Vendor.model');

const RAW_KEY = 'ivs_test_0000000000000000000000000000000000000000000000000000000000';
const hash = crypto.createHash('sha256').update(RAW_KEY).digest('hex');

(async () => {
  await connectDB();
  const v = await Vendor.findOneAndUpdate(
    { email: 'test@vendor.com' },
    { name: 'Test Vendor', email: 'test@vendor.com', apiKeyHash: hash, licences: 100, isActive: true },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log('\nVendor ready:', { id: v._id.toString(), email: v.email, licences: v.licences });
  console.log('API KEY (use at /api-vendor/login):\n  ' + RAW_KEY + '\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
