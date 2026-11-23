/**
 * Runs one payment reconciliation sweep and exits: for every Payment stuck
 * in CREATED beyond the grace period, asks Razorpay directly whether it was
 * actually captured (or failed) and settles it — catching the case where
 * neither the client callback nor the webhook ever reported back.
 *
 *   npm run payments:reconcile
 *
 * The web process already does this on an interval (see src/server.js), so
 * this exists for two cases: running it from cron instead — PM2 cron_restart,
 * or a system crontab — and clearing a backlog by hand after an incident.
 *
 * Safe to run at any time, including alongside the web process. Every
 * transition it performs is an atomic conditional update, so two sweeps
 * racing each other simply means one of them does the work.
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const paymentReconciler = require('../src/services/paymentReconciler.service');

/* eslint-disable no-console */
const run = async () => {
  await mongoose.connect(env.mongodbUri);

  const started = Date.now();
  const { settled, failed, pending } = await paymentReconciler.sweep();

  console.log('');
  console.log(`  settled   ${settled}`);
  console.log(`  failed    ${failed}`);
  console.log(`  pending   ${pending}`);
  console.log(`  took      ${Date.now() - started}ms`);
  console.log('');

  await mongoose.disconnect();
};
/* eslint-enable no-console */

run().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error('Payment reconcile failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
