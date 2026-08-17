const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

const REQUIRED_ENV_VARS = [
  'MONGODB_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'MSG91_AUTH_KEY',
  'MSG91_FLOW_ID',
];

const missingVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

if (missingVars.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:5000',

  mongodbUri: process.env.MONGODB_URI,

  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',

  // Origin(s) of the admin console (the separate ivs-admin-frontend site).
  // Added to the CORS allow-list in app.js. Comma-separated, because Vercel
  // gives every preview deployment its own hostname, so production and a
  // preview need to be allowed at once:
  //   ADMIN_URL=https://ivs-admin-frontend.vercel.app,https://ivs-admin-frontend-git-dev-you.vercel.app
  // Origins only — scheme + host, no path and no trailing slash, since these
  // are compared against the browser's Origin header verbatim.
  adminUrls: (process.env.ADMIN_URL || '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean),

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '1h',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '30d',
  },

  // Admin portal sessions. Falls back to the user access secret so the portal
  // works without extra config, but admin tokens carry a `typ: "admin"` claim
  // that the admin middleware requires and user tokens never have — so a user
  // token can't be replayed against admin routes either way. Set a distinct
  // ADMIN_JWT_SECRET in production to keep the two blast radii separate.
  adminJwt: {
    // Never the raw user access secret. If ADMIN_JWT_SECRET is unset we derive
    // a distinct key from it instead, so admin and user tokens are always
    // signed with different material even when nothing extra is configured —
    // an operator who forgets the variable still gets separation rather than a
    // silent single point of failure.
    //
    // Deriving (rather than requiring the variable) is deliberate: making it
    // mandatory would stop an already-deployed server from booting after an
    // upgrade. Set an explicit ADMIN_JWT_SECRET in production anyway, so that
    // rotating one secret does not rotate the other.
    secret:
      process.env.ADMIN_JWT_SECRET ||
      crypto
        .createHmac('sha256', process.env.JWT_ACCESS_SECRET || '')
        .update('ivs:admin-token:v1')
        .digest('hex'),
    // True only when a dedicated secret was supplied; server.js warns otherwise.
    isDedicated: !!process.env.ADMIN_JWT_SECRET,
    expiry: process.env.ADMIN_JWT_EXPIRY || '12h',
  },

  msg91: {
    authKey: process.env.MSG91_AUTH_KEY,
    flowId: process.env.MSG91_FLOW_ID,
    baseUrl: process.env.MSG91_BASE_URL || 'https://control.msg91.com/api/v5',
    otpLength: parseInt(process.env.MSG91_OTP_LENGTH, 10) || 6,
    otpExpiryMinutes: parseInt(process.env.MSG91_OTP_EXPIRY_MINUTES, 10) || 5,
  },

  // Aadhaar e-KYC via the GREST wrapper around Paysprint's UIDAI OTP API.
  // Not in REQUIRED_ENV_VARS (unlike MSG91) since these aren't provisioned
  // yet — validated lazily in aadhaarProvider.js instead, so the server can
  // still boot without them.
  grestWrapper: {
    baseUrl: process.env.GREST_WRAPPER_BASE_URL || 'https://grest.agbe.in/api',
    authToken: process.env.GREST_WRAPPER_AUTH_TOKEN,
  },
  paysprint: {
    partnerId: process.env.PAYSPRINT_PARTNER_ID,
    authorisedKey: process.env.PAYSPRINT_AUTHORISED_KEY,
  },

  // Aadhaar test mode: lets a fixed list of sandbox Aadhaar numbers verify with
  // a fixed OTP without calling Paysprint/UIDAI at all. Exists so the mobile and
  // web clients can exercise the full KYC flow before provider credentials are
  // live. OFF unless AADHAAR_TEST_MODE is exactly "true" — see the startup
  // warning in server.js, and never enable it on a real production deployment.
  aadhaarTest: {
    enabled: process.env.AADHAAR_TEST_MODE === 'true',
    otp: process.env.AADHAAR_TEST_OTP || '123456',
    numbers: (process.env.AADHAAR_TEST_NUMBERS || '999999990019')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  },

  // IMEI blocklist verification via C-DOT's CEIR (Sanchar Saathi) API.
  // Same lazy-validation approach as Paysprint above.
  cdotIvs: {
    baseUrl: (process.env.CDOT_IVS_BASE_URL || '').replace(/\/+$/, ''),
    username: process.env.CDOT_IVS_USERNAME,
    password: process.env.CDOT_IVS_PASSWORD,
  },

  // Razorpay token top-ups. Lazy-validated in razorpayProvider.js (same as
  // Paysprint/C-DOT) so the server still boots before they're provisioned.
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    apiBaseUrl: (process.env.RAZORPAY_API_BASE_URL || 'https://api.razorpay.com/v1').replace(/\/+$/, ''),
  },

  // Third-party device-diagnosis provider. Lazy-validated in
  // diagnoseProvider.js. Contract TBD — see services/providers/diagnoseProvider.js.
  diagnose: {
    baseUrl: (process.env.DIAGNOSE_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.DIAGNOSE_API_KEY,
  },

  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || '+91',

  upload: {
    maxSizeMb: parseInt(process.env.UPLOAD_MAX_SIZE_MB, 10) || 5,
  },

  // Image/file storage. `driver` selects which provider backs uploads —
  // swap it (and fill the matching credentials block below) to move from
  // Cloudinary to another backend (e.g. AWS S3) with no code changes.
  // See services/providers/storageProvider.js for the driver contract.
  storage: {
    driver: process.env.STORAGE_DRIVER || 'cloudinary',
    imageFolder: process.env.STORAGE_IMAGE_FOLDER || 'ivs/profile',
  },

  // Cloudinary credentials (used when STORAGE_DRIVER=cloudinary). Lazy-
  // validated in cloudinaryProvider.js (same pattern as Razorpay/C-DOT) so
  // the server still boots before it's provisioned.
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },

  // AWS S3 credentials (used when STORAGE_DRIVER=s3). Placeholder — add an
  // s3Provider.js implementing the storage contract when you switch.
  s3: {
    region: process.env.AWS_REGION,
    bucket: process.env.AWS_S3_BUCKET,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },

  isProduction: (process.env.NODE_ENV || 'development') === 'production',
};

module.exports = env;
