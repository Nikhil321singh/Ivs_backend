/**
 * Runs one auction sweep and exits: activates scheduled auctions whose start
 * time has arrived, closes live ones whose end time has passed, and lapses
 * sales the winning bidder never paid for.
 *
 *   npm run auctions:sweep
 *
 * The web process already does this on an interval (see src/server.js), so this
 * exists for two cases: running it from cron instead — PM2 cron_restart, or a
 * system crontab — and closing a backlog by hand after downtime.
 *
 * Safe to run at any time, including alongside the web process. Every
 * transition it performs is an atomic conditional update, so two sweeps racing
 * each other simply means one of them does the work.
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const auctionCloser = require('../src/services/auctionCloser.service');

/* eslint-disable no-console */
const run = async () => {
  await mongoose.connect(env.mongodbUri);

  const started = Date.now();
  const { activated, closed, expired } = await auctionCloser.sweep();

  console.log('');
  console.log(`  activated      ${activated}`);
  console.log(`  closed         ${closed}`);
  console.log(`  payment-expired ${expired}`);
  console.log(`  took           ${Date.now() - started}ms`);
  console.log('');

  await mongoose.disconnect();
};
/* eslint-enable no-console */

run().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error('Auction sweep failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
