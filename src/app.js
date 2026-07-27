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

app.use(helmet());
app.use(
  cors({
    origin: env.clientUrl,
    credentials: true,
  })
);
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

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/v1', generalLimiter, routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
