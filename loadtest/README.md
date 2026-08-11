# Load testing

Two scripts:

| Script | Purpose |
| --- | --- |
| `live-read.k6.js` | Gentle 1-50 VU ramp. Safe to point at production. |
| `capacity.k6.js` | Ramps to a target request rate (default 1000 rps) to find the ceiling. Needs preparation — see below. |

## Capacity test: reaching 1000 rps

```bash
TARGET_RPS=1000 BASE_URL=https://business.grest.in TOKEN=<jwt> \
  k6 run loadtest/capacity.k6.js
```

It ramps 50 → 100 → 300 → 600 → 1000 rps, holds the peak for a minute, then
winds down. It aborts if failures exceed 5%.

Four things must be true first, or you measure something other than the server:

**1. Lift the rate limit on the target.** A load generator is one IP, and the
default is 300 requests per 15 minutes — about 0.33 rps. In the server's `.env`:

```
RATE_LIMIT_DISABLED=true
```

Restart, run the test, then **remove it**. It also disables brute-force
protection on admin login; the server warns at boot while it is set.

**2. Generate load from the same region.** From a laptop the round trip to
Mumbai is ~180 ms, so sustaining 1000 rps needs ~180 requests in flight
(Little's law: concurrency = rate x latency). You will hit your own bandwidth
and connection limits before the server's. Run k6 from an EC2 instance in
`ap-south-1`.

**3. Know your Atlas tier.** On a shared tier (M0) the database saturates long
before Node does. Watch Atlas -> Metrics during the run: if connections or CPU
peg while the box stays idle, the tier is your ceiling and no code change helps.

**4. Use both CPUs.** PM2 runs a single fork, so Node uses one core and the
second sits idle. For a capacity test, switch `ecosystem.config.js` to
`exec_mode: 'cluster'` with `instances: 'max'`.

### Reading the result

- **`dropped iterations` > 0** — the target rate was not sustained. Either the
  server is saturated or the generator ran out of VUs/network.
- **429 rate above 0** — the limiter is still on; step 1 was not applied.
- **p95 climbing while the achieved rate plateaus** — you have found the ceiling.
- **`/health` slow too** — CPU exhausted (t3.micro has 2 burstable vCPU, and
  sustained load exhausts CPU credits, after which it throttles hard).
- **only `/wallet/transactions` and `/ivs/history` slow** — the database.

## Run it

```bash
brew install k6

# public endpoints only
k6 run loadtest/live-read.k6.js

# include authenticated reads
BASE_URL=https://business.grest.in TOKEN=<access-token> k6 run loadtest/live-read.k6.js
```

Ramps 1 → 50 virtual users over three minutes and aborts automatically if more
than 5% of requests fail.

## Before you start

**Know your Atlas tier.** On M0 (free) the cluster saturates long before Node
does, and you will be measuring MongoDB. Check Atlas → Metrics during the run;
if connections or CPU peg while the app stays idle, the tier is the ceiling.

**Watch the box while it runs.** In a second terminal:

```bash
ssh <server> 'pm2 monit'                 # CPU + memory per process
ssh <server> 'tail -f ~/Ivs_backend/logs/pm2-out-0.log'
```

**Pick a quiet window.** This is production; real users share the box.

**Stop if** p95 goes above ~2s, memory climbs and does not come back down
(a leak, not load), or 5xx appear. k6 aborts on the last one by itself.

## What is deliberately not tested

The script only touches endpoints that stay inside our own stack. These are
excluded on purpose:

| Endpoint | Why |
| --- | --- |
| `POST /ivs/verify` | Calls C-DOT CEIR, a government API. Load against it risks the IP being blocked and is not ours to stress. |
| `POST /auth/send-otp` | MSG91 bills per SMS — a five-minute run costs real money and spams real handsets. |
| `/user/aadhaar/*` | Paysprint / UIDAI. |
| `/wallet/topup/*` | Razorpay. |

To load test the paid IMEI path properly, point `CDOT_IVS_BASE_URL` at a stub
that returns a canned CEIR response with a realistic delay, on a staging box
with its own database. That measures our wallet and billing code — which is
where the interesting concurrency lives — without touching anyone else's
service.

## The rate limiter will cap you

Limits are per IP, and a load generator is one IP:

| Limiter | Budget | Sustained rate from one IP |
| --- | --- | --- |
| general (`/api/v1/*`) | 300 / 15 min | 0.33 rps |
| IMEI verify | 30 / 10 min | 0.05 rps |
| OTP | 5 / 10 min | 0.008 rps |

So a single-source run hits 429s within seconds. The summary reports the 429
rate and says so explicitly — if it is non-zero, you measured the limiter, not
the server.

That is a valid first test (it proves the protection works). To measure actual
capacity you need either the limits raised for the run, or load spread across
many source IPs. Note that `trust proxy` is set to 1 and nginx overwrites
`X-Forwarded-For`, so the header cannot be spoofed to fake distinct clients —
by design.

## Interpreting results

- `/health` — no database at all. Pure Node and network; the floor.
- `/api/v1/settings` — served from a 15s in-process cache, so mostly Node.
- `/api/v1/pricing` — same cache.
- `/user/profile` — one indexed lookup.
- `/ivs/history` — paged query plus a count, the heaviest read here.

If `/health` degrades, the box is out of CPU. If only `/ivs/history` degrades,
it is the database.
