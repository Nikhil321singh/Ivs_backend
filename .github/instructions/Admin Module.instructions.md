
---
name: Admin Module
description: Rules, conventions, and boundaries for working on the Grest IVS admin module (src/admin/ and /api/v1/admin/* routes).
applyTo: "src/admin/**"
---

# Admin Module

## 1. Folder boundary

All admin code lives under `src/admin/`. Nothing outside that folder should import from it. The only integration point with the core API is `src/admin/index.js`, which exports the Express router. Keep it that way — it is what allows the module to be extracted into its own service without a refactor.

```
src/admin/
├── index.js              # sole integration point
├── controllers/          # request handlers (admin.controller.js)
├── middleware/           # adminAuth.middleware.js
├── models/               # Admin (operators) model
├── routes/               # admin.routes.js + OpenAPI annotations
├── services/             # admin.service.js, *.admin.service.js
├── utils/                # scrypt password hashing
└── validators/           # admin.validator.js
```

Any shared logic (helpers, constants, core models) is imported with `../../` paths. When adding a new dependency on a core file, keep the list in the `README.md` extraction checklist up to date.

## 2. Authentication

Every protected route must pass through `adminAuth` middleware from `middleware/adminAuth.middleware.js`.

- Admin tokens carry `typ: "admin"`. A user token is always rejected, even when signed with the same secret.
- `adminAuth` re-reads the Admin row on every request. Deactivating an account revokes access immediately.
- The current admin document is available as `req.admin` inside any handler that runs after `adminAuth`.
- Never loosen or skip `adminAuth` to make development easier.

```js
// correct
router.get('/some-route', adminAuth, adminController.someHandler);

// wrong — always guard admin routes
router.get('/some-route', adminController.someHandler);
```

## 3. Route conventions

- Mount everything under `/api/v1/admin/`. The prefix is applied in `src/routes/index.js`.
- Follow the existing OpenAPI annotation style (`@openapi` JSDoc above each route, matching tags `[Admin]`, `security: [{ bearerAuth: [] }]`).
- Use `validateRequest` middleware after any validator array.
- Apply rate limiting on unauthenticated endpoints (login is the only one today).

```js
router.post('/login', adminLoginLimiter, loginValidator, validateRequest, adminController.login);
router.get('/some-resource', adminAuth, adminController.listSomething);
router.patch('/some-resource/:id', adminAuth, someValidator, validateRequest, adminController.updateSomething);
```

## 4. Controller conventions

- Every handler is wrapped in `asyncHandler`.
- Return with `successResponse(res, httpStatus.STATUS, MESSAGES.ADMIN.KEY, payload)`.
- Keep controllers thin — delegate all business logic to a service.
- Log sensitive changes (settings, account actions) with `console.warn('[Admin] ...')`.

```js
const doSomething = asyncHandler(async (req, res) => {
  const result = await someAdminService.doSomething(req.params.id, req.body);
  successResponse(res, httpStatus.OK, MESSAGES.ADMIN.SOMETHING_DONE, { result });
});
```

## 5. Service conventions

- Place admin-specific services in `src/admin/services/`.
- Name them `<domain>.admin.service.js` for domain-specific files (e.g. `auction.admin.service.js`).
- General admin operations (login, listings, stats) go in `admin.service.js`.
- Services may read from core models (`User`, `WalletTransaction`, `ImeiVerificationLog`, etc.) but should not write to them unless it is genuinely an admin operation (e.g. adjusting a wallet balance).

## 6. Settings

- `Setting` model and `settingsService` live in core, not in `src/admin/`.
- To add a new configurable flag, add it to `src/constants/settings.js` only. The admin portal renders toggles automatically from `SETTING_DEFINITIONS` — no portal change needed.
- Guard the feature in the main API with `await settingsService.get('keyName')`.
- Do not add per-admin or per-session state to `Setting`. It is a global live-config store, not a preferences store.

## 7. IVS / CEIR references

- The IMEI blocklist service is called **IVS** or **CEIR** in code, routes, comments, and logs.
- Do not use "CDOT", "C-DOT", or any variation of it anywhere — not in route paths, variable names, comments, or log messages.
- The provider is `src/services/providers/ivsProvider.js`. Import it as `ivsProvider`.
- Result fields use `imei1RawStatus` / `imei2RawStatus`, not `imei1CdotStatus` / `imei2CdotStatus`.
- Environment config key is `env.ivs` (not `env.cdotIvs`). Corresponding env vars are `IVS_BASE_URL`, `IVS_USERNAME`, `IVS_PASSWORD`.

## 8. Security rules

- Admins are a separate collection from users. Never grant admin access based on any field on a `User` document.
- Passwords are hashed with scrypt (`utils/password.util.js`). Do not introduce bcrypt or any native dependency.
- Return a single generic error for both unknown email and wrong password at login — never reveal which one failed.
- All admin endpoints must be served over HTTPS in production.
- Do not log passwords, tokens, or raw credentials anywhere.

## 9. What not to do

- Do not add routes outside `src/admin/routes/admin.routes.js`.
- Do not import from `src/admin/` in any core file.
- Do not put admin-only models (e.g. `Admin.model.js`) in `src/models/`.
- Do not bypass `adminAuth` for convenience.
- Do not reference CDOT by name anywhere in this module.
