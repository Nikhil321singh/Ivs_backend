# IVS Mobile Application — Backend

Production-ready REST API for the IVS Mobile Application. Authentication is
Mobile Number + OTP only (via MSG91) — there is no password login. Every user
must complete KYC before accessing app services.

Designed as the API layer for a future React + Capacitor mobile app: all
endpoints are versioned, stateless (JWT), and return a consistent response
envelope.

## Tech Stack

Node.js, Express.js, MongoDB (Mongoose), JWT + Refresh Tokens, MSG91 (OTP),
Express Validator, Multer, Helmet, Morgan, CORS, express-rate-limit, Swagger.

## Folder Structure

```
src/
  config/       env loading, MongoDB connection
  controllers/  thin HTTP handlers (req/res only)
  models/       Mongoose schemas (User, RefreshToken)
  routes/       Express routers + Swagger (OpenAPI) annotations
  services/     business logic (otp, token, user, upload)
  middleware/   auth, validation, rate limiting, upload, error handling
  validators/   express-validator rule chains
  helpers/      apiResponse, asyncHandler
  utils/        ApiError, JWT signing/verification, hashing
  constants/    HTTP status codes, user-facing messages, enums
  docs/         Swagger/OpenAPI spec definition
  uploads/      uploaded profile images (served at /uploads)
  app.js        Express app assembly
  server.js     process entrypoint (DB connect + listen)
```

## Getting Started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Fill in `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (use long
   random strings — e.g. `openssl rand -hex 64`), and your MSG91 credentials
   (`MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `MSG91_SENDER_ID`).

3. **Run MongoDB** locally, or point `MONGODB_URI` at a remote cluster.

4. **Start the server**

   ```bash
   npm run dev    # nodemon, auto-restart
   npm start      # production
   ```

5. **API docs**: Swagger UI is served at `http://localhost:5000/api-docs`.

## Authentication Flow

1. `POST /api/v1/auth/send-otp` — sends an OTP to the mobile number via MSG91.
2. `POST /api/v1/auth/verify-otp` — verifies the OTP with MSG91. Creates the
   user on first login, then issues an access token (1h) and refresh token
   (30d) for the supplied `deviceId`. The response includes `kycCompleted` so
   the client knows whether to route to the KYC screen or Home.
3. Client stores both tokens and attaches
   `Authorization: Bearer <accessToken>` to subsequent requests.
4. When the access token expires, call `POST /api/v1/auth/refresh-token` with
   the stored refresh token + `deviceId`. On success both tokens are rotated
   (a new refresh token is issued and the old one invalidated for that
   device). If the refresh token is invalid, expired, or revoked, the client
   should log the user out and navigate to Login.
5. `POST /api/v1/auth/logout` revokes the refresh token for the current
   device only — other logged-in devices are unaffected.

Refresh tokens are never stored in plaintext: only a SHA-256 hash is
persisted in the `RefreshToken` collection, one document per
(`userId`, `deviceId`) pair, with a MongoDB TTL index that auto-purges
expired sessions.

## KYC Flow

After login, if `kycCompleted` is `false`, the client should navigate to the
KYC screen and submit `POST /api/v1/user/complete-kyc` as
`multipart/form-data` with `name`, `email`, `panNumber`, `aadhaarNumber`, and
a `profileImage` file. On success `kycCompleted` becomes `true`.

## API Reference

All endpoints are versioned under `/api/v1`. Response envelope:

```json
// success
{ "success": true, "message": "...", "data": {} }

// failure
{ "success": false, "message": "...", "errors": [] }
```

### Auth

| Method | Endpoint                     | Auth | Description                          |
|--------|-------------------------------|------|--------------------------------------|
| POST   | `/api/v1/auth/send-otp`       | No   | Send OTP to mobile number            |
| POST   | `/api/v1/auth/verify-otp`     | No   | Verify OTP, login/signup, get tokens |
| POST   | `/api/v1/auth/refresh-token`  | No   | Rotate access + refresh tokens       |
| POST   | `/api/v1/auth/logout`         | Yes  | Revoke session for current device    |
| GET    | `/api/v1/auth/profile`        | Yes  | Get current user profile             |

### User

| Method | Endpoint                      | Auth | Description                     |
|--------|--------------------------------|------|----------------------------------|
| POST   | `/api/v1/user/complete-kyc`    | Yes  | Submit KYC details + photo      |
| PUT    | `/api/v1/user/update-profile`  | Yes  | Update name / email / photo     |
| GET    | `/api/v1/user/profile`         | Yes  | Get current user profile        |

A ready-to-import Postman collection is included: `postman_collection.json`.

## Environment Variables

See `.env.example` for the full list with descriptions. Required at boot:
`MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `MSG91_AUTH_KEY`,
`MSG91_TEMPLATE_ID`, `MSG91_SENDER_ID`. The server refuses to start if any
are missing.

## Adding Future Modules

The `DO NOT USE` / `FUTURE MODULES` list (roles, admin panel, notifications,
payments, diagnostics, IVS verification, records, support, settings) was
intentionally left out of this version. The MVC layout, service-based
business logic, and versioned routing (`/api/v1`) mean new modules can be
added as new `models/routes/services/controllers` files without touching
existing ones.
