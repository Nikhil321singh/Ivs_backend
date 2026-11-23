/**
 * Read-only per-user summary of IVS (IMEI Verification) checks in October 2026.
 *
 *   node scripts/ivs-october.js
 *   node scripts/ivs-october.js --format csv
 *   node scripts/ivs-october.js --limit 1000
 *
 * Writes nothing. Safe to point at production.
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const ImeiVerificationLog = require('../src/models/ImeiVerificationLog.model');
const User = require('../src/models/User.model');

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

const run = async () => {
  const limit = parseInt(arg('limit'), 10) || 1000;
  const csv = hasFlag('format') && arg('format') === 'csv';

  await mongoose.connect(env.mongodbUri);

  const start = new Date('2026-10-01T00:00:00.000Z');
  const end = new Date('2026-11-01T00:00:00.000Z');

  // aggregate per-user stats
  const perUser = await ImeiVerificationLog.aggregate([
    { $match: { createdAt: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: '$userId',
        total: { $sum: 1 },
        billable: { $sum: { $cond: [{ $eq: ['$billable', true] }, 1, 0] } },
        totalCost: { $sum: { $ifNull: ['$cost', 0] } },
        clean: { $sum: { $cond: [{ $eq: ['$imei1Status', 'CLEAN'] }, 1, 0] } },
        blocked: { $sum: { $cond: [{ $eq: ['$imei1Status', 'BLOCKED'] }, 1, 0] } },
        stolen: { $sum: { $cond: [{ $eq: ['$imei1Status', 'STOLEN'] }, 1, 0] } },
        unknown: { $sum: { $cond: [{ $eq: ['$imei1Status', 'UNKNOWN'] }, 1, 0] } },
        firstCheck: { $min: '$createdAt' },
        lastCheck: { $max: '$createdAt' },
      },
    },
    { $sort: { total: -1 } },
    { $limit: limit },
  ]);

  // pull user details for the ids found
  const userIds = perUser.map((r) => r._id);
  const users = await User.find({ _id: { $in: userIds } })
    .select('name mobile companyName')
    .lean();
  const userMap = Object.fromEntries(users.map((u) => [String(u._id), u]));

  const grandTotal = perUser.reduce((s, r) => s + r.total, 0);
  const grandBillable = perUser.reduce((s, r) => s + r.billable, 0);
  const grandCost = perUser.reduce((s, r) => s + r.totalCost, 0);

  /* eslint-disable no-console */
  console.log('\n=== IVS checks — October 2026 (per user) ===');
  console.log(`Users       : ${perUser.length}`);
  console.log(`Total checks: ${grandTotal}  |  Billable: ${grandBillable}  |  Total tokens: ${grandCost}`);
  console.log('');

  if (csv) {
    console.log('userId,name,mobile,companyName,total,billable,totalCost,clean,blocked,stolen,unknown,firstCheck,lastCheck');
    perUser.forEach((r) => {
      const u = userMap[String(r._id)] || {};
      console.log([
        r._id,
        `"${(u.name || '').replace(/"/g, '""')}"`,
        u.mobile || '',
        `"${(u.companyName || '').replace(/"/g, '""')}"`,
        r.total,
        r.billable,
        r.totalCost,
        r.clean,
        r.blocked,
        r.stolen,
        r.unknown,
        new Date(r.firstCheck).toISOString(),
        new Date(r.lastCheck).toISOString(),
      ].join(','));
    });
  } else {
    const col = (s, w) => String(s).padEnd(w);
    console.log(
      col('userId', 26) +
      col('name / company', 28) +
      col('mobile', 14) +
      col('total', 7) +
      col('bill', 6) +
      col('cost', 7) +
      col('CLEAN', 7) +
      col('BLOCK', 7) +
      col('STOLN', 7) +
      col('UNK', 5)
    );
    console.log('-'.repeat(107));
    perUser.forEach((r) => {
      const u = userMap[String(r._id)] || {};
      const label = u.companyName || u.name || '—';
      console.log(
        col(r._id, 26) +
        col(label.slice(0, 27), 28) +
        col(u.mobile || '—', 14) +
        col(r.total, 7) +
        col(r.billable, 6) +
        col(r.totalCost, 7) +
        col(r.clean, 7) +
        col(r.blocked, 7) +
        col(r.stolen, 7) +
        col(r.unknown, 5)
      );
    });
  }

  console.log('');
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect();
  process.exit(1);
});
