/**
 * Seeds the three catalogue credit packs on a fresh database.
 *
 *   npm run seed:plans           # create anything missing, leave the rest alone
 *   npm run seed:plans -- --force   # also reset prices/quotas to the values below
 *
 * Idempotent: it upserts by `code` and, without --force, NEVER overwrites a
 * plan that already exists. Prices are meant to be tuned from the admin portal,
 * and a redeploy that quietly reset them to these defaults would undo real
 * pricing decisions. --force exists for local resets, not production.
 *
 * >>> THE PRICES BELOW ARE PLACEHOLDERS. <<<
 * They are internally consistent — the discount deepens with each tier, and all
 * three sit above the custom-tier rate so the ladder validates — but they are
 * not a pricing decision. Set the real ones in the portal (or here before the
 * first run). What matters structurally is only the ORDER: Basic discounts
 * least, Pro Max most, and custom is 5% below Pro Max's per-check rate.
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const Plan = require('../src/models/Plan.model');
const planService = require('../src/services/plan.service');
const settingsService = require('../src/services/settings.service');
const { PLAN_TIER, PLAN_AUDIENCE } = require('../src/constants/entitlementEnums');

const FORCE = process.argv.includes('--force');

const PLANS = [
  {
    code: 'BASIC',
    name: 'Basic',
    tier: PLAN_TIER.BASIC,
    quotas: { IVS_CHECK: 20, DIAGNOSE: 10 },
    pricePaise: 79900, // ₹799  (list ₹880  → ~9% off)
    sortOrder: 1,
    audience: PLAN_AUDIENCE.ALL,
  },
  {
    code: 'PRO',
    name: 'Pro',
    tier: PLAN_TIER.PRO,
    quotas: { IVS_CHECK: 30, DIAGNOSE: 20 },
    pricePaise: 129900, // ₹1,299 (list ₹1,570 → ~17% off)
    badge: 'Most popular',
    highlight: true,
    sortOrder: 2,
    audience: PLAN_AUDIENCE.ALL,
  },
  {
    code: 'PRO_MAX',
    name: 'Pro Max',
    tier: PLAN_TIER.PRO_MAX,
    quotas: { IVS_CHECK: 40, DIAGNOSE: 30 },
    pricePaise: 169900, // ₹1,699 (list ₹2,260 → ~25% off) — the custom anchor
    badge: 'Best value',
    sortOrder: 3,
    audience: PLAN_AUDIENCE.ALL,
  },
];

/* eslint-disable no-console */
const seed = async () => {
  await mongoose.connect(env.mongodbUri);

  const results = [];

  for (const definition of PLANS) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await Plan.findOne({ code: definition.code });

    if (existing && !FORCE) {
      results.push({ code: definition.code, action: 'kept' });
      continue;
    }

    if (existing) {
      Object.assign(existing, definition);
      // eslint-disable-next-line no-await-in-loop
      await existing.save();
      results.push({ code: definition.code, action: 'reset' });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await Plan.create(definition);
      results.push({ code: definition.code, action: 'created' });
    }
  }

  const settings = await settingsService.getAll();
  const { plans, custom } = await planService.listForUser(null);
  const { errors, warnings } = await planService.validateLadder(settings);

  console.log('');
  results.forEach(({ code, action }) => console.log(`  ${action.padEnd(8)} ${code}`));
  console.log('');
  console.log('  Catalogue as the app now sees it:');
  plans.forEach((plan) => {
    const rates = Object.entries(plan.rates)
      .map(([feature, paise]) => `${feature} ₹${(paise / 100).toFixed(2)}`)
      .join(', ');
    console.log(
      `    ${plan.code.padEnd(8)} ₹${String(plan.priceInr).padEnd(7)} ${String(plan.discountPercent).padStart(2)}% off   ${rates}`
    );
  });
  console.log(
    `    ${'CUSTOM'.padEnd(8)} from ₹${custom.startingAt / 100} ${String(custom.discountPercent).padStart(2)}% off   min ${custom.minimums.IVS_CHECK} IMEI / ${custom.minimums.DIAGNOSE} diagnose`
  );
  console.log('');

  if (errors.length) {
    console.log('  BROKEN LADDER — a pack is cheaper per check than the custom tier:');
    errors.forEach((error) => console.log(`    ${error.message}`));
    console.log('');
  }
  warnings.forEach((warning) => console.log(`  warning: ${warning}`));
  if (warnings.length) console.log('');

  await mongoose.disconnect();
};
/* eslint-enable no-console */

seed().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error('Seeding plans failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
