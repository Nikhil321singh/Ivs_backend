/**
 * Runs BEFORE any test module is imported (jest `setupFiles`).
 *
 * src/config/env.js validates required vars at import time and calls
 * process.exit(1) if any is missing — which would kill the Jest worker with no
 * useful message. Seeding them here is what makes the suite importable at all.
 *
 * Every value is fake. Nothing here reaches a real provider: the suite stubs
 * MSG91, C-DOT, Paysprint and Razorpay with nock, and test/setup/db.js swaps
 * MONGODB_URI for an in-memory server.
 */
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.API_BASE_URL = 'http://localhost:5000';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.ADMIN_URL = 'http://localhost:8080';

// Replaced by the in-memory server in db.js; present so env.js validation passes.
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/ivs_test_placeholder';

process.env.JWT_ACCESS_SECRET = 'test-access-secret-not-used-anywhere-real';
process.env.JWT_ACCESS_EXPIRY = '1h';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-not-used-anywhere-real';
process.env.JWT_REFRESH_EXPIRY = '30d';
process.env.ADMIN_JWT_SECRET = 'test-admin-secret-not-used-anywhere-real';
process.env.ADMIN_JWT_EXPIRY = '12h';

process.env.MSG91_AUTH_KEY = 'test-msg91-key';
process.env.MSG91_FLOW_ID = 'test-flow-id';
process.env.MSG91_BASE_URL = 'https://control.msg91.com/api/v5';
process.env.MSG91_OTP_LENGTH = '6';
process.env.MSG91_OTP_EXPIRY_MINUTES = '5';

process.env.GREST_WRAPPER_BASE_URL = 'https://grest.test/api';
process.env.GREST_WRAPPER_AUTH_TOKEN = 'test-wrapper-token';
process.env.PAYSPRINT_PARTNER_ID = 'TESTPARTNER';
process.env.PAYSPRINT_AUTHORISED_KEY = 'test-authorised-key';

process.env.CDOT_IVS_BASE_URL = 'https://ivs.test.gov/api';
process.env.CDOT_IVS_USERNAME = 'test-cdot-user';
process.env.CDOT_IVS_PASSWORD = 'test-cdot-pass';

process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'test-razorpay-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.RAZORPAY_API_BASE_URL = 'https://api.razorpay.com/v1';

process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-cloud-key';
process.env.CLOUDINARY_API_SECRET = 'test-cloud-secret';
process.env.STORAGE_DRIVER = 'cloudinary';

// Feature bypasses stay OFF by default so tests assert real behaviour; the
// specs that need them set the flag and re-require config/env themselves.
process.env.AADHAAR_TEST_MODE = 'false';
process.env.OTP_TEST_MODE = 'false';
process.env.OTP_TEST_NUMBERS = '';

process.env.DEFAULT_COUNTRY_CODE = '+91';
process.env.UPLOAD_MAX_SIZE_MB = '5';
