/**
 * Stage-by-stage tracing for POST /api/v1/ivs/verify.
 *
 * Exists to answer one question: did we send C-DOT exactly what we think we
 * sent, and did we store exactly what C-DOT sent back? So the provider stage
 * logs the outbound URL and body verbatim and the response body verbatim,
 * un-summarised — a masked IMEI or a pre-mapped status would defeat the point.
 *
 * That means trace output contains full IMEIs, so it is off unless IVS_TRACE
 * is explicitly 'true'. Credentials are never traced: the login stage reports
 * only that it ran and when the token expires.
 *
 * Every line carries the same referenceId as the API response and the stored
 * ImeiVerificationLog row, so one check can be followed end to end:
 *
 *   grep 'IVS-1786431874802-90d0bf35' app.log
 */
const env = require('../config/env');

const enabled = env.cdotIvs.trace;

/**
 * Elapsed-time counter. Each stage reports ms since the timer was made, so the
 * C-DOT round trip is visible separately from wallet and Mongo time.
 */
const timer = () => {
  const startedAt = Date.now();
  return () => Date.now() - startedAt;
};

/**
 * `data` is JSON-stringified rather than passed as an object so nested response
 * bodies print in full — console.log collapses anything past ~2 levels to
 * [Object], which would hide the C-DOT payload this exists to show.
 */
const trace = (stage, referenceId, data = {}) => {
  if (!enabled) return;
  // eslint-disable-next-line no-console
  console.log(`[IVS TRACE] ${stage} ref=${referenceId || '-'} ${JSON.stringify(data)}`);
};

module.exports = { trace, timer, enabled };
