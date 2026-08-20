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

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '1h',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '30d',
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
  aadhaar: {
    // Dev-only escape hatch for local/QA testing when the UIDAI/Paysprint
    // upstream is down or flaky: skip the real OTP call and accept devOtp.
    // Only honored when AADHAAR_DEV_BYPASS=true AND NODE_ENV !== production
    // (see aadhaarProvider.js) — can never take effect in production.
    devBypass: process.env.AADHAAR_DEV_BYPASS === 'true',
    devOtp: process.env.AADHAAR_DEV_OTP || '123456',
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

  // Image/file storage — AWS S3. imageFolder is the default object-key prefix
  // for uploaded images (-> <imageFolder>/<userId>). See
  // services/providers/s3Provider.js for the driver.
  storage: {
    imageFolder: process.env.STORAGE_IMAGE_FOLDER || 'ivs/profile',
  },

  // AWS S3. The Cognito Identity Pool has guest access disabled, so the backend
  // signs in a shared "service account" User Pool user (svcUsername/svcPassword
  // against userPoolClientId) to get an ID token, which the Identity Pool
  // (identityPoolId) exchanges for temporary S3 creds — no static access keys.
  // identityPoolRegion falls back to the bucket region when unset. Lazy-
  // validated in s3Provider.isConfigured() (same pattern as Razorpay/C-DOT) so
  // the server still boots before Cognito is provisioned.
  s3: {
    region: process.env.AWS_REGION,
    bucket: process.env.AWS_S3_BUCKET,
    identityPoolId: process.env.AWS_COGNITO_IDENTITY_POOL_ID,
    identityPoolRegion: process.env.AWS_COGNITO_REGION,
    userPoolId: process.env.AWS_COGNITO_USER_POOL_ID,
    userPoolClientId: process.env.AWS_COGNITO_USER_POOL_WEB_CLIENT_ID,
    svcUsername: process.env.AWS_COGNITO_SVC_USERNAME,
    svcPassword: process.env.AWS_COGNITO_SVC_PASSWORD,
  },

  // Push notifications via Firebase Cloud Messaging. Credentials come from a
  // Firebase service account JSON (Project Settings -> Service Accounts ->
  // Generate new private key): project_id/client_email/private_key map to
  // FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY. .env can't hold real
  // newlines, so store the private key with literal \n escapes — unescaped
  // in fcmProvider.js before use. Lazy-validated there (same pattern as
  // Razorpay/C-DOT/S3) so the server still boots before Firebase is
  // provisioned.
  fcm: {
    projectId: process.env.FCM_PROJECT_ID,
    clientEmail: process.env.FCM_CLIENT_EMAIL,
    privateKey: process.env.FCM_PRIVATE_KEY,
  },

  isProduction: (process.env.NODE_ENV || 'development') === 'production',
};

module.exports = env;
