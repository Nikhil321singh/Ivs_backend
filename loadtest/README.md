# Load testing

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
