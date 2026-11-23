/**
 * Active reconciliation for Payment rows stuck in CREATED.
 *
 * The webhook is meant to be the source of truth for every payment, but a
 * WebView-hosted UPI intent checkout has a failure mode neither client path
 * survives: control hands off to the bank/UPI app, and Android can kill the
 * WebView's activity while it's gone, so the JS handler and the redirect
 * `callback_url` both never fire. If the webhook delivery also misses, the
 * payment can be captured on Razorpay's side forever without this system
 * ever finding out. This sweep closes that gap by periodically asking
 * Razorpay directly about every CREATED payment old enough that the normal
 * paths have had their chance.
 */
const Payment = require('../models/Payment.model');
const { PAYMENT_STATUS } = require('../constants/walletEnums');
const paymentService = require('./payment.service');

// Give the client callback and the webhook time to land before a CREATED
// payment counts as stuck, so a sweep every few minutes doesn't race a
// checkout that's still in flight.
const GRACE_PERIOD_MS = 5 * 60 * 1000;

// Razorpay orders expire 15 minutes after creation if unpaid. Beyond a day
// old there is nothing left to find — stop spending API calls on it.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** One full pass. Safe to run concurrently with itself and with live traffic. */
const sweep = async () => {
  const now = Date.now();
  const stuck = await Payment.find({
    status: PAYMENT_STATUS.CREATED,
    createdAt: { $lte: new Date(now - GRACE_PERIOD_MS), $gte: new Date(now - MAX_AGE_MS) },
  });

  let settled = 0;
  let failed = 0;
  let pending = 0;

  for (const payment of stuck) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await paymentService.reconcilePendingPayment(payment);
      if (outcome === 'settled') settled += 1;
      else if (outcome === 'failed') failed += 1;
      else pending += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[PaymentReconciler] failed for', String(payment._id), err.message);
    }
  }

  if (settled || failed) {
    // eslint-disable-next-line no-console
    console.log(
      `[PaymentReconciler] sweep: ${settled} settled, ${failed} failed, ${pending} still pending`
    );
  }

  return { settled, failed, pending };
};

let timer = null;

/**
 * Starts the periodic sweep. PM2 runs this app with `instances: 1`; every
 * transition this performs is an atomic conditional update (via
 * `creditForPayment`/`markPaymentFailed`), so it stays correct if that ever
 * changes. `scripts/payment-reconcile.js` runs the same pass from cron for
 * anyone who would rather schedule it outside the web process.
 */
const startSweeper = ({ intervalMs = 5 * 60 * 1000 } = {}) => {
  if (timer) return timer;

  timer = setInterval(() => {
    sweep().catch((err) => console.error('[PaymentReconciler] sweep failed:', err.message));
  }, intervalMs);

  if (timer.unref) timer.unref();

  return timer;
};

const stopSweeper = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { sweep, startSweeper, stopSweeper };
