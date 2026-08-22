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

/**
 * Firebase service-account credentials, supplied either as three separate
 * variables or as the whole downloaded JSON in one.
 *
 * The JSON form exists because the private key is a multi-line PEM, and most
 * hosting dashboards (Render, PM2 ecosystem files) mangle multi-line values on
 * paste. Base64 of that JSON is accepted for the same reason. Never throws: bad
 * credentials must leave FCM merely unconfigured — notifications still persist
 * to the in-app inbox — rather than stop the server from booting.
 */
const parseFcmServiceAccount = () => {
  const raw = (process.env.FCM_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return {};

  try {
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      '[FCM] FCM_SERVICE_ACCOUNT_JSON is neither JSON nor base64-encoded JSON — ignoring it. ' +
        'Push notifications stay disabled until it is fixed.'
    );
    return {};
  }
};

const fcmServiceAccount = parseFcmServiceAccount();

const missingVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

if (missingVars.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

// Public origin of this API, trailing slash stripped so it can be concatenated
// safely (the Razorpay checkout callback URL is built from it).
const apiBaseUrl = (process.env.API_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  apiBaseUrl,

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

  // Login OTP test mode. Numbers listed here sign in with a fixed OTP and no
  // SMS is sent — needed because app store reviewers cannot receive an Indian
  // SMS, and useful for QA. Deliberately env-driven rather than an admin-console
  // toggle: a fixed OTP is a login bypass, so flipping it must require server
  // access, not just an admin session. OFF unless OTP_TEST_MODE is exactly
  // "true"; server.js warns loudly at boot while it is on.
  otpTest: {
    enabled: process.env.OTP_TEST_MODE === 'true',
    otp: process.env.OTP_TEST_OTP || '123456',
    numbers: (process.env.OTP_TEST_NUMBERS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
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
    // Signs the JWT. Structurally this is b64(CORP_ID + b64(secret)) — the
    // value the DigiLocker documentation calls "JWT KEY".
    jwtKey: process.env.PAYSPRINT_AUTHORISED_KEY,
    // The `Authorisedkey` request header, which the provider issues as a
    // SEPARATE value — structurally b64(secret + CORP_ID). Falls back to the
    // JWT key so nothing breaks before the real one is provisioned, but the two
    // are not interchangeable and the provider will reject the wrong one once
    // it starts validating them.
    authorisedKey: process.env.PAYSPRINT_AUTHORISEDKEY || process.env.PAYSPRINT_AUTHORISED_KEY,
    // SprintVerify's own base URL, used by the DigiLocker flow, which calls the
    // provider directly rather than through the GREST wrapper above.
    //   UAT  https://uat.paysprint.in/sprintverify-uat/api/v1/verification
    //   PROD https://api.verifya2z.com/api/v1/verification
    // The UAT host serves the OTP e-KYC product only. DigiLocker has NO UAT
    // endpoint — it is live on PROD alone, so every DigiLocker call is made
    // against production and a successful one is billed. There is also no
    // AADHAAR_TEST_MODE bypass for it: that switch keys off the Aadhaar number
    // (see aadhaarProvider.js), which the DigiLocker flow never collects.
    // No default: an unset value must fail loudly at call time rather than
    // silently pointing a production deployment at UAT (or the reverse).
    baseUrl: process.env.PAYSPRINT_BASE_URL,
  },

  // DigiLocker Aadhaar verification. Shares the Paysprint/SprintVerify
  // credentials above — the same partnerId signs the JWT for every SprintVerify
  // product. `redirectUrl` is where DigiLocker sends the user's browser once
  // they finish authenticating; providers normally require it to be registered
  // with them, so it must match what was whitelisted for this environment.
  digilocker: {
    redirectUrl:
      process.env.DIGILOCKER_REDIRECT_URL ||
      `${process.env.API_BASE_URL || ''}/api/v1/user/aadhaar/digilocker/callback`,
    // Where the browser is sent after the callback finishes, carrying only the
    // verification id. Falls back to the app's client URL.
    appReturnUrl: process.env.DIGILOCKER_APP_RETURN_URL || process.env.CLIENT_URL,
    // A session is useless once the user has wandered off; TTL-purged after this.
    sessionTtlMinutes: parseInt(process.env.DIGILOCKER_SESSION_TTL_MINUTES || '15', 10),
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
    // Where Razorpay Checkout POSTs the result when it runs in redirect mode
    // (required for the Capacitor WebView flow — see payment.service.js).
    // Must be publicly reachable, so it is derived from API_BASE_URL unless
    // overridden explicitly.
    callbackUrl: (
      process.env.RAZORPAY_CALLBACK_URL || `${apiBaseUrl}/api/v1/wallet/topup/callback`
    ).replace(/\/+$/, ''),
    // Where the WebView is sent after we have processed that callback. Set it
    // to a deep link the app intercepts (e.g. ivsapp://payment/result); when
    // unset we fall back to a plain result page served by this API, which the
    // app can just as well detect by URL.
    webviewReturnUrl: (process.env.RAZORPAY_WEBVIEW_RETURN_URL || '').replace(/\/+$/, ''),
  },

  // Third-party device-diagnosis provider. Lazy-validated in
  // diagnoseProvider.js. Contract TBD — see services/providers/diagnoseProvider.js.
  diagnose: {
    baseUrl: (process.env.DIAGNOSE_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.DIAGNOSE_API_KEY,
  },

  // Firebase Cloud Messaging (HTTP v1). Credentials come from the Firebase
  // console -> Project settings -> Service accounts -> "Generate new private
  // key". Lazy-validated in services/providers/fcmProvider.js like the other
  // providers, so the server boots fine before they are provisioned — pushes
  // are simply skipped while the in-app inbox keeps working.
  //
  // We speak the REST API directly (axios + a signed JWT, exactly like the
  // Paysprint integration) rather than pulling in firebase-admin, which drags
  // in gRPC and a large dependency tree for two HTTP calls.
  fcm: {
    projectId: process.env.FCM_PROJECT_ID || fcmServiceAccount.project_id,
    clientEmail: process.env.FCM_CLIENT_EMAIL || fcmServiceAccount.client_email,
    // A PEM has real newlines; .env files cannot, so "\n" escapes are the
    // conventional encoding and are unescaped back here.
    privateKey: (process.env.FCM_PRIVATE_KEY || fcmServiceAccount.private_key || '').replace(
      /\\n/g,
      '\n'
    ),
    // Android 8+ ignores a notification whose channel does not exist on the
    // device, so this must match the channel the app creates at startup.
    androidChannelId: process.env.FCM_ANDROID_CHANNEL_ID || 'ivs_default',
    // Ask FCM to validate the request without delivering anything. Useful for
    // rehearsing a broadcast against production credentials.
    dryRun: process.env.FCM_DRY_RUN === 'true',
    // How many token sends are in flight at once. HTTP v1 has no multicast
    // endpoint — every device is its own request — so this bounds the fan-out
    // of a broadcast instead of opening one socket per user.
    concurrency: parseInt(process.env.FCM_CONCURRENCY, 10) || 20,
  },

  // App version gate for the mobile clients. Values here are only the fallback
  // used before an operator saves a release in the admin console; the stored
  // AppVersion row wins once it exists.
  appUpdate: {
    androidStoreUrl:
      process.env.APP_ANDROID_STORE_URL ||
      'https://play.google.com/store/apps/details?id=in.grest.ivs',
    iosStoreUrl: process.env.APP_IOS_STORE_URL || 'https://apps.apple.com/app/id0000000000',
  },

  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || '+91',

  upload: {
    maxSizeMb: parseInt(process.env.UPLOAD_MAX_SIZE_MB, 10) || 5,
  },

  // Image/file storage. `driver` selects which provider backs uploads (AWS S3
  // today); swap it and add the matching credentials block to change backends
  // with no code changes. See services/providers/storageProvider.js for the
  // driver contract.
  storage: {
    driver: process.env.STORAGE_DRIVER || 's3',
    imageFolder: process.env.STORAGE_IMAGE_FOLDER || 'ivs/profile',
  },

  // AWS S3 (used when STORAGE_DRIVER=s3 — the default). No static access keys:
  // the backend signs in a shared Cognito User Pool service account to get an ID
  // token, which the Identity Pool exchanges for temporary S3 credentials — the
  // same model as the web client (src/lib/amplify.js). identityPoolRegion falls
  // back to the bucket region. Lazy-validated in s3Provider.isConfigured().
  s3: {
    region: process.env.AWS_REGION,
    bucket: process.env.AWS_S3_BUCKET,
    identityPoolId: process.env.AWS_COGNITO_IDENTITY_POOL_ID,
    identityPoolRegion: process.env.AWS_COGNITO_REGION || process.env.AWS_REGION,
    userPoolId: process.env.AWS_COGNITO_USER_POOL_ID,
    userPoolClientId: process.env.AWS_COGNITO_USER_POOL_WEB_CLIENT_ID,
    svcUsername: process.env.AWS_COGNITO_SVC_USERNAME,
    svcPassword: process.env.AWS_COGNITO_SVC_PASSWORD,
  },

  isProduction: (process.env.NODE_ENV || 'development') === 'production',
};

module.exports = env;
