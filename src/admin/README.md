# Admin module

Self-contained admin console: a static portal served at `/admin` backed by
`/api/v1/admin/*`. Kept in its own folder so it can be lifted into a separate
repository without unpicking it from the main API.

```
src/admin/
├── index.js              # the ONLY integration point with the core API
├── controllers/          # request handlers
├── middleware/           # adminAuth — admin JWT + active-row check
├── models/               # Admin (operators)
├── routes/               # /api/v1/admin/* + OpenAPI annotations
├── services/             # login, listings, dashboard stats
├── utils/                # scrypt password hashing
├── validators/           # login + settings-patch validation
└── public/               # the portal UI (HTML/CSS/JS, no build step)
```

## How it attaches to the core API

Exactly two lines, both consuming `src/admin/index.js`:

| File | Line |
| --- | --- |
| `src/routes/index.js` | `router.use('/admin', adminModule.router)` |
| `src/app.js` | `app.use('/admin', express.static(adminModule.publicDir))` |

Nothing else in the app reaches into `src/admin/**`. Keep it that way — it is
what makes extraction a copy rather than a refactor.

## What it depends on from core

Extracting this folder means providing these. Everything is small and has no
admin-specific logic in it.

**Shared plumbing** (copy or reimplement):

- `helpers/asyncHandler`, `helpers/apiResponse`
- `utils/apiError`, `constants/httpStatus`, `constants/messages`
- `middleware/validateRequest.middleware`, `middleware/rateLimiter.middleware`
- `config/env`

**Shared data** (must point at the same MongoDB):

- `models/User.model`, `models/WalletTransaction.model`,
  `models/ImeiVerificationLog.model` — read-only, for the listing screens
- `models/Setting.model`, `services/settings.service`, `constants/settings`

## The settings boundary

`Setting` deliberately lives in **core**, not here. The admin portal *writes*
settings; the main API *reads* them on hot paths (every KYC and Aadhaar
request). Both sides need the model, so it belongs to whichever service owns the
request path — that is the API.

If this module becomes its own repo, both services keep talking to the same
`settings` collection in the same database. The admin repo needs its own copy of
`Setting.model.js` and `constants/settings.js`; the API keeps reading through
its 15-second cache and picks up changes without any cross-service call. Adding
a message queue or webhook between them would buy nothing over that cache.

## Extraction checklist

1. Copy `src/admin/` to the new repo as `src/`.
2. Copy the shared plumbing and data files listed above.
3. Rewrite the `../../` requires — they are the only paths that reach outside
   this folder, so `grep -rn "require('\.\./\.\./" src/` finds all of them.
4. Add an entry point that mounts `routes/admin.routes.js` and serves `public/`.
5. Point `MONGODB_URI` at the same database as the API.
6. Set `ADMIN_JWT_SECRET` — no longer able to fall back to `JWT_ACCESS_SECRET`.
7. Move `scripts/seed-admin.js` across.

## Adding a setting

One place, and the portal renders it automatically:

```js
// src/constants/settings.js  (core)
diagnoseEnabled: {
  type: 'boolean',
  default: true,
  label: 'Diagnose enabled',
  description: 'Turn the device diagnosis feature off when the provider is down.',
}
```

Then guard the feature with `await settingsService.get('diagnoseEnabled')`. The
validator rejects unknown keys, so no portal change is needed — the toggle
appears on its own.

## Security notes

- Admins are a **separate collection** from users. The portal keeps working when
  MSG91 is down, and no state on a `User` document can grant admin access.
- Passwords use Node's built-in **scrypt** (`utils/password.util.js`), so the
  install stays free of native dependencies for `npm ci --omit=dev`.
- Admin tokens carry `typ: "admin"`, which user tokens never have, so a user
  token is rejected even when both are signed with the same secret.
- `adminAuth` re-reads the Admin row on every request, so deactivating an
  account revokes access immediately rather than at token expiry.
- Login is rate limited (10 per 15 min) and returns one error for both unknown
  email and wrong password, so admin emails cannot be enumerated.
- **Serve this over HTTPS.** It is a password login; on plain HTTP the
  credentials cross the network in the clear.
