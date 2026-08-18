# Security assessment — IVS backend

**Date:** 12 August 2026
**Scope:** `Ivs_backend` source at `300136a`, live API `https://business.grest.in`,
the secondary host `15.252.29.112`, and the GitHub repository.
**Method:** source review, dependency audit, TLS/header inspection, and
non-destructive functional probes run against a local instance with stubbed
providers. No load was generated against third-party services (C-DOT CEIR,
MSG91, Paysprint, Razorpay) and no destructive testing was performed on
production.

---

## Summary

| # | Finding | Severity |
| --- | --- | --- |
| 1 | Aadhaar hash is unsalted SHA-256 and returned in API responses — recoverable in ~80 seconds | **High** |
| 2 | Repository is public | **High** |
| 3 | Second server exposed on port 5000, unpatched, writing to the production database | **High** |
| 4 | No per-account OTP attempt limit — protection is per-IP only | **Medium** |
| 5 | `ADMIN_JWT_SECRET` unset, so admin and user tokens share a signing key | **Medium** |
| 6 | Three high-severity dependency advisories | **Medium** |
| 7 | Swagger UI publicly exposed | **Low** |
| 8 | JWT verification does not pin the algorithm | **Low** |
| 9 | Aadhaar verification currently disabled in production | **Informational** |

**Verified as sound:** TLS 1.3 with HSTS and HTTP→HTTPS redirect; helmet
security headers; scrypt password hashing with constant-time comparison;
constant-time HMAC comparison on both Razorpay signature paths; upload MIME and
size limits; per-user scoping on every listing endpoint (no IDOR found); input
validation rejecting NoSQL operator objects; no mass-assignment path to
privilege, KYC state or wallet balance; atomic wallet debits that cannot
overdraw under concurrency; no secrets committed to git.

---

## 1. Aadhaar hash is effectively reversible, and is exposed — High

`aadhaarNumberHash` is an unsalted SHA-256 of the 12-digit Aadhaar number
(`src/utils/hash.util.js`), and it is returned in API responses because
`User.toJSON` does not strip it (`src/models/User.model.js`).

An Aadhaar number has roughly 8x10^11 valid values. At ~10 GH/s — a single
commodity GPU — that space is exhausted in **about 80 seconds**. The hash is
therefore equivalent to storing the number in the clear.

Two consequences:

- The code comment "the full Aadhaar number is never persisted" is technically
  true but gives false assurance: a database leak is an Aadhaar leak.
- `GET /user/profile`, `complete-kyc`, `verify-otp` and `skip-kyc` all return
  the hash to the client, widening exposure to logs, proxies, crash reporters
  and client-side storage.

It also makes a statement in the published privacy policy inaccurate: it says
"The hash cannot be reversed to recover the number."

**Remediation**

1. Strip `aadhaarNumberHash` in the `toJSON` transform, exactly as
   `profileImagePublicId` already is. One line, no migration.
2. Replace the digest with a keyed HMAC using a server-held pepper
   (`HMAC-SHA256(aadhaar, AADHAAR_HASH_PEPPER)`), so brute force is infeasible
   without the key. Note the migration constraint: the plaintext is not stored,
   so existing rows cannot be recomputed — verify against the legacy digest and
   upgrade each row the next time that user verifies.
3. Correct the privacy policy once (2) ships.

## 2. Repository is public — High

`github.com/Nikhil321singh/Ivs_backend` is public. Anyone can read the full
source of a KYC and payments system: validation rules, business logic, the
admin module, and every bypass switch (`AADHAAR_TEST_MODE`, `OTP_TEST_MODE`,
`RATE_LIMIT_DISABLED`).

No credentials are committed — that was checked across all history for
`mongodb+srv://`, `rzp_live`/`rzp_test`, `AKIA` and PEM blocks, and the only
matches were placeholder values and a comment describing a key prefix. So the
immediate exposure is design, not keys. But the margin for error is zero: one
careless commit of a `.env` becomes public instantly, and `.env.example` has
already had a live Atlas URI pasted into it once during this project.

**Remediation:** make the repository private. If it must stay public, add a
pre-commit secret scanner (gitleaks) and enable GitHub push protection.

## 3. Stale second server on the production database — High

`15.252.29.112:5000` is still serving, reachable without TLS, running commit
`c317e34` (7 commits behind), and connected to the **same Atlas cluster** as
production.

That old build predates the soft-delete semantics, dynamic pricing and the
signup-bonus logic. Anything that reaches it — a stale mobile build, a cached
DNS entry, a scanner — writes inconsistent data into live records. It is also an
unmonitored, unpatched host exposing an API over plain HTTP.

**Remediation:** terminate the instance and release its Elastic IP. If it is
kept as staging, repoint `MONGODB_URI` at a separate database first and close
port 5000 to the internet.

## 4. No per-account OTP attempt limit — Medium

`verifyOtp` compares the hash and fails, but nothing counts failures against the
OTP record (`src/services/otp.service.js`, `src/models/Otp.model.js`). The only
protection is `otpLimiter`, which is **per IP** (5 per 10 minutes).

A 6-digit OTP is 10^6 values with a 5-minute window. One IP gets 5 guesses, but
a distributed attacker targeting a single mobile number is limited only by how
many source addresses they have; the account itself never locks and the OTP is
never invalidated early.

**Remediation:** add an `attempts` counter to the OTP document, increment on
each failure, and delete the record after 5 — forcing the attacker back through
`send-otp`, which is itself rate limited.

## 5. Admin and user tokens share a signing key — Medium

`env.adminJwt.secret` falls back to `JWT_ACCESS_SECRET`
(`src/config/env.js`), and `ADMIN_JWT_SECRET` is **not set** on the server.

This is not directly exploitable: admin tokens carry `typ: "admin"`, which user
tokens never have, and `adminAuth` re-reads the Admin row on every request. But
it removes a layer — anything that discloses the user access secret immediately
yields admin tokens too, and the two have very different blast radii.

**Remediation:** set a distinct, randomly generated `ADMIN_JWT_SECRET` in
production.

## 6. Dependency advisories — Medium

`npm audit --omit=dev` reports **3 high-severity** advisories, including
`js-yaml` quadratic CPU consumption (GHSA-5p4m-2wfm-xmqj), reachable through
`swagger-jsdoc`. Exploitation requires parsing attacker-controlled YAML, which
this app does not do at request time, so real-world exposure is limited — but
these ship in the production dependency tree.

**Remediation:** run `npm audit fix`, re-run `npm test` (70 tests) to confirm
nothing regressed, and schedule the audit as a recurring check.

## 7. Swagger UI publicly exposed — Low

`https://business.grest.in/api-docs` returns 200 unauthenticated, publishing the
full endpoint inventory, request shapes and validation rules. Not a
vulnerability in itself — the repository is public anyway — but it hands an
attacker a complete map and is unnecessary in production.

**Remediation:** serve `/api-docs` only when `NODE_ENV !== 'production'`, or put
it behind admin authentication.

## 8. JWT algorithm not pinned — Low

`jwt.verify(token, secret)` is called without an `algorithms` option in
`src/utils/jwt.util.js` and `src/admin/services/admin.service.js`. Current
`jsonwebtoken` versions reject `alg: none` by default, so this is defence in
depth rather than a live vulnerability.

**Remediation:** pass `{ algorithms: ['HS256'] }` at all three call sites.

## 9. Aadhaar verification disabled in production — Informational

The `settings` collection has `aadhaarVerificationEnabled = false`, set 11
August. Aadhaar is currently optional for every user, and KYC completes without
it. This is the kill switch working as designed, but if it was left on after
debugging, users are onboarding unverified.

**Action:** confirm this is intentional.

---

## What was tested and found sound

- **Authorization:** `/ivs/history`, `/wallet`, `/wallet/transactions` and
  `/referral` all scope to `req.user.id`; supplying `?userId=<other>` does not
  widen access.
- **Injection:** operator objects (`{"$ne": null}`, `{"$gt": ""}`) in `mobile`,
  `otp` and `imei1` are rejected at validation with 422.
- **Mass assignment:** submitting `aadhaarVerified`, `status`, `role`,
  `kycCompleted`, `balance` or `cost` alongside legitimate fields does not
  change any of them; a client-supplied `cost: 0` is ignored and the server
  price is charged.
- **Business logic:** the signup bonus cannot be farmed by repeated sign-in or
  by delete-and-restore; a deleted account's existing access token is rejected
  immediately rather than at expiry.
- **Concurrency:** ten simultaneous debits against a 100-token wallet succeed
  exactly five times and settle at zero.
- **Payments:** both Razorpay signature paths use HMAC-SHA256 with a
  constant-time comparison, and a tampered signature is rejected.
- **Uploads:** MIME allow-list and a size limit, held in memory rather than
  written to disk.
- **Error handling:** stack traces are not returned to clients; internal errors
  are logged only outside production.

## Suggested order of work

1. Strip `aadhaarNumberHash` from API responses (minutes, no migration)
2. Make the repository private
3. Decommission `15.252.29.112`
4. Set `ADMIN_JWT_SECRET`; confirm the Aadhaar switch is intentional
5. `npm audit fix`; gate `/api-docs`; pin JWT algorithms
6. Add the OTP attempt counter
7. Plan the HMAC pepper migration for the Aadhaar hash
