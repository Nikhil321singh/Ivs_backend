/**
 * Credits tokens to a user's wallet, so QA can exercise paid features without
 * a real Razorpay top-up.
 *
 *   npm run seed:credit -- --mobile 9717753079 --tokens 500
 *   npm run seed:credit -- --mobile 9717753079            # defaults to 500
 *   MOBILE=9717753079 TOKENS=500 npm run seed:credit
 *
 * Goes through walletService.credit, so it writes a real WalletTransaction row
 * and moves the balance atomically — the same path a Razorpay top-up takes.
 * The ledger entry is recorded as ADJUSTMENT (manual/admin correction) rather
 * than TOPUP, so seeded tokens are never mistaken for money that was actually
 * paid, in the admin console or in any future reporting.
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User.model');
const walletService = require('../src/services/wallet.service');
const { TXN_REASON } = require('../src/constants/walletEnums');
const PRICING = require('../src/constants/pricing');

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
};

const MOBILE = arg('mobile') || process.env.MOBILE || '9717753079';
const TOKENS = parseInt(arg('tokens') || process.env.TOKENS || '500', 10);

const seed = async () => {
  if (!Number.isInteger(TOKENS) || TOKENS <= 0) {
    throw new Error(`--tokens must be a positive whole number (got "${TOKENS}")`);
  }

  await mongoose.connect(env.mongodbUri);

  const user = await User.findOne({ mobile: MOBILE });

  if (!user) {
    throw new Error(
      `No user with mobile ${MOBILE}. Create one with: npm run seed:test-user`
    );
  }

  const before = await walletService.getBalance(user._id);

  await walletService.credit(user._id, TOKENS, {
    reason: TXN_REASON.ADJUSTMENT,
    metadata: { source: 'seed-credit script' },
  });

  const after = await walletService.getBalance(user._id);

  /* eslint-disable no-console */
  console.log('');
  console.log(`Credited ${TOKENS} tokens to ${user.countryCode}${user.mobile}`);
  console.log(`  balance: ${before} -> ${after}`);
  console.log('');
  console.log('  That covers:');
  Object.entries(PRICING.FEATURES).forEach(([feature, cost]) => {
    console.log(`    ${feature.padEnd(12)} ${cost} tokens  ->  ${Math.floor(after / cost)} checks`);
  });
  console.log('');
  /* eslint-enable no-console */

  await mongoose.disconnect();
};

seed().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error('Credit failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
