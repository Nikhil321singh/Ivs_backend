/**
 * Live-safe load test for the IVS API.
 *
 *   k6 run loadtest/live-read.k6.js
 *   BASE_URL=https://business.grest.in TOKEN=<jwt> k6 run loadtest/live-read.k6.js
 *
 * Deliberately touches ONLY endpoints that stay inside our own stack —
 * nginx, Node, Mongo. Nothing here calls C-DOT, MSG91, Paysprint or Razorpay.
 *
 * NOT tested here, on purpose:
 *   POST /ivs/verify          -> C-DOT CEIR, a government API. Load against it
 *                                risks the IP being blocked, and it is not ours
 *                                to stress. Test it against a stub instead.
 *   POST /auth/send-otp       -> MSG91 bills per SMS. A 5-minute run would cost
 *                                real money and spam real handsets.
 *   /user/aadhaar/*           -> Paysprint/UIDAI.
 *   /wallet/topup/*           -> Razorpay.
 *
 * Set TOKEN to a valid user access token to include authenticated reads. Get
 * one by logging in normally and copying it from the app or an API client.
 */
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'https://business.grest.in';
const TOKEN = __ENV.TOKEN || '';

// Tracked separately so a rate-limited run is obvious in the summary rather
// than looking like success.
const rateLimited = new Rate('rate_limited_429');
const publicLatency = new Trend('latency_public', true);
const authedLatency = new Trend('latency_authed', true);

export const options = {
  scenarios: {
    // Gentle ramp. Stops well short of anything that looks like an attack on
    // your own box; raise only once you have watched a run at these levels.
    ramp: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '1m', target: 20 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Abort the run if the API starts failing outright — no point pushing a
    // box that is already broken.
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '15s' }],
    'latency_public{endpoint:health}': ['p(95)<800'],
    http_req_duration: ['p(95)<2000'],
  },
};

const get = (path, tag, useAuth = false) => {
  const params = {
    tags: { endpoint: tag },
    headers: useAuth ? { Authorization: `Bearer ${TOKEN}` } : {},
  };

  const res = http.get(`${BASE_URL}${path}`, params);

  rateLimited.add(res.status === 429);
  (useAuth ? authedLatency : publicLatency).add(res.timings.duration, { endpoint: tag });

  check(res, {
    [`${tag}: not 5xx`]: (r) => r.status < 500,
    [`${tag}: not rate limited`]: (r) => r.status !== 429,
  });

  return res;
};

export default function run() {
  group('public reads', () => {
    get('/health', 'health');
    get('/api/v1/health', 'api_health');
    get('/api/v1/settings', 'settings');
    get('/api/v1/pricing', 'pricing');
  });

  if (TOKEN) {
    group('authenticated reads', () => {
      // Profile is a single indexed lookup; history is a paged query plus a
      // count — the more interesting of the two under load.
      get('/api/v1/user/profile', 'profile', true);
      get('/api/v1/ivs/history?page=1&limit=20', 'history', true);
      get('/api/v1/wallet', 'wallet', true);
    });
  }

  // Think time. Without it k6 hammers as fast as the network allows, which
  // measures your bandwidth rather than the server.
  sleep(1);
}

export function handleSummary(data) {
  const m = data.metrics;
  const line = (label, value) => `  ${label.padEnd(28)}${value}`;
  const ms = (v) => (v === undefined ? 'n/a' : `${Math.round(v)} ms`);

  const out = [
    '',
    `Target: ${BASE_URL}`,
    line('requests', m.http_reqs ? m.http_reqs.values.count : 0),
    line('failed', `${((m.http_req_failed?.values.rate || 0) * 100).toFixed(2)}%`),
    line('429 rate limited', `${((m.rate_limited_429?.values.rate || 0) * 100).toFixed(2)}%`),
    line('p50 latency', ms(m.http_req_duration?.values.med)),
    line('p95 latency', ms(m.http_req_duration?.values['p(95)'])),
    line('p99 latency', ms(m.http_req_duration?.values['p(99)'])),
    line('max latency', ms(m.http_req_duration?.values.max)),
    '',
    (m.rate_limited_429?.values.rate || 0) > 0.01
      ? 'NOTE: 429s present — you measured the rate limiter, not the server.'
      : 'No rate limiting hit; these numbers reflect the app.',
    '',
  ].join('\n');

  return { stdout: out };
}
