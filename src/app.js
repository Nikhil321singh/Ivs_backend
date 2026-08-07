const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');

const env = require('./config/env');
const swaggerSpec = require('./docs/swagger');
const routes = require('./routes');
const walletController = require('./controllers/wallet.controller');
const { generalLimiter } = require('./middleware/rateLimiter.middleware');
const notFoundHandler = require('./middleware/notFound.middleware');
const errorHandler = require('./middleware/error.middleware');

const app = express();

// Render (and most PaaS) put a single reverse proxy in front of the app, so the
// real client IP arrives in X-Forwarded-For. Trust exactly one hop so
// express-rate-limit can key on the true client IP instead of throwing
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR. Use 1 (not `true`) so clients can't spoof
// the header to dodge the rate limiter.
app.set('trust proxy', 1);

app.use(helmet());

// Allowed browser origins: the web dev client plus the Capacitor mobile
// WebView. On Android with androidScheme "http" the WebView origin is
// http://localhost (no port); iOS/other configs use capacitor://localhost or
// https://localhost. Requests with no Origin (curl, server-to-server, adb) are
// allowed through.
// The admin console is a separate static site (ivs-admin-frontend repo), so it
// is cross-origin to this API and must be allow-listed explicitly via
// ADMIN_URL. Without it every console request is blocked by the browser even
// though the API answers correctly — a login that silently does nothing.
const allowedOrigins = [
  env.clientUrl,
  ...env.adminUrls,
  'http://localhost:5173', // Vite dev server default
  'http://localhost:5713', // kept: pre-existing entry, likely a typo for 5173
  'http://localhost:3000',
  'http://localhost:8080',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
].filter(Boolean);

// Per-request CORS: besides the static allow-list, always accept requests whose
// Origin matches the host actually serving this request. That covers Swagger
// UI's "Try it out" (served from the API's own host, e.g. the Render URL) on
// any deployment without depending on API_BASE_URL being set correctly. We also
// return origin:false (rather than throwing) for disallowed origins so the
// browser gets a clean CORS rejection instead of a 500.
const corsDelegate = (req, callback) => {
  const origin = req.header('Origin');
  const host = req.header('Host'); // trusted via `trust proxy` (X-Forwarded-Host)
  const selfOrigins = host ? [`https://${host}`, `http://${host}`] : [];
  const isAllowed =
    !origin || allowedOrigins.includes(origin) || selfOrigins.includes(origin);
  callback(null, { origin: isAllowed, credentials: true });
};
app.use(cors(corsDelegate));
// Skip HTTP request logging under test to keep the test output readable.
if (env.nodeEnv !== 'test') {
  app.use(morgan(env.isProduction ? 'combined' : 'dev'));
}

// Razorpay webhook must see the RAW body to verify the HMAC signature, so it
// is registered BEFORE express.json() (which would consume/reparse the body).
// It sits outside the /api/v1 rate limiter and JSON parser by design.
app.post(
  '/api/v1/wallet/webhook/razorpay',
  express.raw({ type: '*/*' }),
  walletController.handleRazorpayWebhook
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Top-level liveness endpoints for platform health checks (Render pings
// `/health`) and a friendly root. The full API health check lives at
// /api/v1/health. Kept outside the rate limiter so probes never get throttled.
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
app.get('/', (req, res) =>
  res.status(200).json({ name: 'IVS API', docs: '/api-docs', health: '/api/v1/health' })
);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/v1', generalLimiter, routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
