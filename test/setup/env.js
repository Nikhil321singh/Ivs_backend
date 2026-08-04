/**
 * Seeds process.env before src/config/env.js is imported. That module
 * validates a set of REQUIRED_ENV_VARS at load and calls process.exit(1) if
 * any are missing, so these must exist first.
 *
 * The Razorpay secrets here are the crux of the payment tests: signature
 * verification uses them, and the tests generate matching HMACs with the SAME
 * values (see test/helpers/razorpay.js) to exercise real signature checks.
 * The outbound order-creation HTTP call is stubbed with nock, so no real
 * Razorpay account is involved.
 *
 * MONGODB_URI is a throwaway placeholder — it only needs to be non-empty to
 * satisfy env.js. The real connection uses the in-memory server URI set in
 * test/setup/db.js.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/placeholder';

process.env.JWT_ACCESS_SECRET = 'test_access_secret';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
process.env.JWT_ACCESS_EXPIRY = '1h';

process.env.MSG91_AUTH_KEY = 'test_msg91_key';
process.env.MSG91_FLOW_ID = 'test_msg91_flow';

process.env.RAZORPAY_KEY_ID = 'rzp_test_key_id';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_test_webhook_secret';
process.env.RAZORPAY_API_BASE_URL = 'https://api.razorpay.com/v1';
