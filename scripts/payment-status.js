/**
 * Read-only dump of recent Razorpay top-up orders, for debugging the WebView
 * checkout flow. Answers, for a given attempt: did it reach PAID, and by
 * which path — the redirect callback, the webhook, or not at all?
 *
 *   npm run payments:status                    # last 20
 *   npm run payments:status -- --limit 50
 *   npm run payments:status -- --order order_XXXXXXXX
 *
 * Writes nothing, ever. Safe to point at production.
 *
 * Reading the output:
 *   CREATED + no paymentId  -> checkout opened, payment never completed
 *   CREATED + paymentId     -> shouldn't happen; a credit was interrupted
 *   PAID    + signature     -> credited from the client: either /topup/verify
 *                              or the redirect callback. The row cannot tell
 *                              them apart — both store the signature — so use
 *                              the timestamp against your deploy to decide.
 *   PAID    + no signature  -> credited by the webhook
 *   FAILED                  -> Razorpay reported payment.failed
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const Payment = require('../src/models/Payment.model');

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
};

const run = async () => {
  const limit = parseInt(arg('limit'), 10) || 20;
  const orderId = arg('order');

  await mongoose.connect(env.mongodbUri);

  const filter = orderId ? { razorpayOrderId: orderId } : {};
  const rows = await Payment.find(filter).sort({ createdAt: -1 }).limit(limit).lean();

  const counts = await Payment.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);

  /* eslint-disable no-console */
  console.log('\nAll-time totals:', counts.map((c) => `${c._id}=${c.n}`).join('  ') || '(none)');
  console.log(`\nShowing ${rows.length} most recent:\n`);

  rows.forEach((r) => {
    // The webhook stores a null signature; both client paths (/topup/verify
    // and the redirect callback) store a real one. So the signature separates
    // webhook from client, but not the two client paths from each other.
    const path = r.creditTxnId ? (r.razorpaySignature ? 'client' : 'webhook') : '—';
    console.log(
      [
        new Date(r.createdAt).toISOString(),
        r.status.padEnd(7),
        r.razorpayOrderId.padEnd(22),
        (r.razorpayPaymentId || '—').padEnd(22),
        `₹${(r.amountPaise / 100).toString().padStart(6)}`,
        `${String(r.tokens).padStart(5)} tok`,
        `credited via ${path}`,
      ].join('  ')
    );
  });
  console.log('');

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect();
  process.exit(1);
});
