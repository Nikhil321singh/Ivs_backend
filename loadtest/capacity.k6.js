/**
 * Capacity test — how the API behaves approaching 1000 requests/second.
 *
 *   TARGET_RPS=1000 BASE_URL=https://business.grest.in TOKEN=<jwt> \
 *     k6 run loadtest/capacity.k6.js
 *
 * Uses a ramping ARRIVAL RATE, not virtual users: the goal is a request rate,
 * and k6 adds VUs as needed to sustain it. If it cannot, `dropped_iterations`
 * rises — that is the signal that the server (or the generator) is the limit.
 *
 * SCOPE: only endpoints that stay inside our own stack. Aadhaar and IMEI
 * verification are excluded — they call UIDAI/Paysprint and C-DOT CEIR, which
 * are third-party services, one of them a government API. Load against those
 * is not ours to generate. See loadtest/README.md.
 *
 * PREREQUISITES — without these you measure the wrong thing:
 *   1. RATE_LIMIT_DISABLED=true on the target, or the per-IP limiter caps a
 *      single generator at ~0.33 rps.
 *   2. Run from a box in the same region as the server. From a laptop, 180ms
 *      of round-trip means ~180 concurrent VUs just to hold 1000 rps, and you
 *      measure your own network.
 *   3. Know the Atlas tier. On a shared tier the database saturates first.
 */
import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const TOKEN = __ENV.TOKEN || '';
const TARGET_RPS = parseInt(__ENV.TARGET_RPS || '1000', 10);

const rateLimited = new Rate('rate_limited_429');
const byEndpoint = new Trend('latency_by_endpoint', true);

// Weighted to look like real traffic: mostly cheap reads, some database work.
// Cached endpoints alone would flatter the server and prove nothing.
const ENDPOINTS = [
  { path: '/health', tag: 'health', auth: false, weight: 20 },
  { path: '/api/v1/health', tag: 'api_health', auth: false, weight: 10 },
  { path: '/api/v1/settings', tag: 'settings', auth: false, weight: 20 },
  { path: '/api/v1/pricing', tag: 'pricing', auth: false, weight: 10 },
  { path: '/api/v1/user/profile', tag: 'profile', auth: true, weight: 15 },
  { path: '/api/v1/wallet', tag: 'wallet', auth: true, weight: 10 },
  { path: '/api/v1/wallet/transactions?page=1&limit=20', tag: 'transactions', auth: true, weight: 5 },
  { path: '/api/v1/ivs/history?page=1&limit=20', tag: 'history', auth: true, weight: 5 },
  { path: '/api/v1/referral', tag: 'referral', auth: true, weight: 5 },
];

const pool = [];
ENDPOINTS.forEach((e) => {
  if (e.auth && !TOKEN) return;
  for (let i = 0; i < e.weight; i += 1) pool.push(e);
});

export const options = {
  scenarios: {
    capacity: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      // Generous headroom: k6 allocates VUs to hold the rate. Little's law —
      // at 200ms latency, 1000 rps needs ~200 concurrent in flight.
      preAllocatedVUs: 200,
      maxVUs: 1500,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m', target: 300 },
        { duration: '1m', target: 600 },
        { duration: '1m', target: TARGET_RPS },
        { duration: '1m', target: TARGET_RPS },   // hold, to see if it degrades
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    // Bail out rather than keep hammering a box that is already failing.
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '20s' }],
    http_req_duration: ['p(95)<1500'],
    dropped_iterations: ['count<1000'],
  },
};

export default function run() {
  const target = pool[Math.floor(Math.random() * pool.length)];

  const res = http.get(`${BASE_URL}${target.path}`, {
    tags: { endpoint: target.tag },
    headers: target.auth ? { Authorization: `Bearer ${TOKEN}` } : {},
    timeout: '10s',
  });

  rateLimited.add(res.status === 429);
  byEndpoint.add(res.timings.duration, { endpoint: target.tag });

  check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'not rate limited': (r) => r.status !== 429,
    'not a server error': (r) => r.status < 500,
  });
}

export function handleSummary(data) {
  const m = data.metrics;
  const ms = (v) => (v === undefined ? 'n/a' : `${Math.round(v)} ms`);
  const pct = (v) => `${((v || 0) * 100).toFixed(2)}%`;
  const row = (k, v) => `  ${k.padEnd(26)}${v}`;

  const achieved = m.http_reqs ? m.http_reqs.values.rate : 0;
  const dropped = m.dropped_iterations ? m.dropped_iterations.values.count : 0;
  const limited = m.rate_limited_429 ? m.rate_limited_429.values.rate : 0;

  const notes = [];
  if (limited > 0.01) {
    notes.push('429s seen — the per-IP limiter is capping you. Set RATE_LIMIT_DISABLED=true on the target.');
  }
  if (dropped > 0) {
    notes.push(`${dropped} iterations dropped — the target rate was not sustained. Either the server is saturated or the generator ran out of VUs/network.`);
  }
  if ((m.http_req_failed?.values.rate || 0) > 0.01) {
    notes.push('Failures above 1% — check the server logs for 5xx and memory.');
  }
  if (notes.length === 0) {
    notes.push('Target rate sustained with no rate limiting and no failures.');
  }

  return {
    stdout: [
      '',
      `Target: ${BASE_URL}   requested peak: ${TARGET_RPS} rps`,
      row('achieved rate', `${achieved.toFixed(1)} rps`),
      row('requests', m.http_reqs ? m.http_reqs.values.count : 0),
      row('failed', pct(m.http_req_failed?.values.rate)),
      row('429 rate limited', pct(limited)),
      row('dropped iterations', dropped),
      row('p50', ms(m.http_req_duration?.values.med)),
      row('p95', ms(m.http_req_duration?.values['p(95)'])),
      row('p99', ms(m.http_req_duration?.values['p(99)'])),
      row('max', ms(m.http_req_duration?.values.max)),
      '',
      ...notes.map((n) => `  ! ${n}`),
      '',
    ].join('\n'),
  };
}
