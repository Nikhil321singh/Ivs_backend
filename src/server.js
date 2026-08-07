const env = require('./config/env');
const connectDB = require('./config/database');
const app = require('./app');

let server;

const start = async () => {
  if (env.aadhaarTest.enabled) {
    // eslint-disable-next-line no-console
    console.warn(
      `WARNING: AADHAAR_TEST_MODE is ON. Aadhaar numbers [${env.aadhaarTest.numbers.join(', ')}] ` +
        'verify locally with a fixed OTP and never reach UIDAI. Unset AADHAAR_TEST_MODE before going live.'
    );
  }

  await connectDB();

  server = app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`IVS backend running in ${env.nodeEnv} mode on port ${env.port}`);
    // eslint-disable-next-line no-console
    console.log(`Swagger docs available at ${env.apiBaseUrl}/api-docs`);
  });
};

const shutdown = (signal) => {
  // eslint-disable-next-line no-console
  console.log(`${signal} received. Shutting down gracefully...`);
  if (server) {
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  // eslint-disable-next-line no-console
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

start();
