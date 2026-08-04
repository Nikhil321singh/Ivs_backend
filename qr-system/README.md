# Single-use, self-refreshing QR backend

One active QR at a time. The instant it's scanned it becomes invalid, a fresh
QR is generated, and every connected display is pushed the new code over SSE.
Un-scanned codes also auto-rotate on a TTL so they can't be hoarded and reused.

Storage is in-memory (a `Map`) — restarting the server clears all tokens.

## Run

```bash
cd qr-system
npm install

# Minimum: set the link the phone is redirected to after a successful scan.
REDIRECT_URL="https://your-static-link.example.com" npm start
```

For a phone to actually reach the scan URL, the QR must encode a host the phone
can hit — not `localhost`. Set `PUBLIC_BASE_URL` to your machine's LAN IP (find
it with `ipconfig getifaddr en0` on macOS) or a public tunnel:

```bash
REDIRECT_URL="https://your-static-link.example.com" \
PUBLIC_BASE_URL="http://192.168.1.20:4000" \
npm start
```

### Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | Port to listen on |
| `REDIRECT_URL` | placeholder | Where a phone is sent after a valid scan **(set this)** |
| `PUBLIC_BASE_URL` | `http://localhost:PORT` | Origin baked into the QR URL — must be phone-reachable |
| `TOKEN_TTL_MS` | `60000` | How long an un-scanned QR stays valid before auto-rotating |

## API (for the frontend team)

The **display page** you build should:

1. Open the SSE stream and render a QR whenever a `token` event arrives.
2. Encode `verifyUrl` (the field in the event) into the QR image — use any
   client-side QR library (e.g. `qrcode` / `qrcodejs`). The backend does **not**
   render the image; it only supplies the URL.

### `GET /events` — SSE (real-time, recommended)

Emits a `token` event on connect and on every rotation:

```js
const es = new EventSource("http://<backend-host>:4000/events");
es.addEventListener("token", (e) => {
  const { token, verifyUrl, expiresAt, ttlMs } = JSON.parse(e.data);
  renderQrCode(verifyUrl);   // <- draw the QR from verifyUrl
});
```

The screen refreshes automatically: the moment a phone scans, this fires again
with a brand-new `verifyUrl`.

### `GET /api/current` — polling fallback

If you'd rather short-poll instead of SSE, hit this (e.g. every 2s) and re-render
when `token` changes:

```json
{ "token": "…", "verifyUrl": "http://…/verify?token=…", "expiresAt": 1730000000000, "ttlMs": 60000 }
```

### `GET /verify?token=…` — the scan target (backend-handled)

This is what the QR points at; the phone opens it directly. You don't call it
from JS.
- **Valid + active** → `302` redirect to `REDIRECT_URL`.
- **Used / expired / unknown** → `410` with a styled "Expired QR Code" HTML page.

### `GET /health`

`{ "status": "ok" }`.

## Notes & caveats

- **Single-use is race-safe.** The validity check and the "mark used" flip run
  synchronously in one tick, so two simultaneous scans can't both succeed — the
  second gets the expired page.
- **Link-preview crawlers can consume a token.** Any bot that *fetches* the
  `/verify` URL (some chat apps generate link previews) will burn that single-use
  code. If that becomes an issue, gate the redirect behind an interstitial
  "Tap to continue" page or a bot-check — ask backend to add it.
- **In-memory store** means no horizontal scaling as-is: with multiple server
  instances behind a load balancer, tokens minted on one aren't known to
  another. Move the store + SSE fan-out to Redis (pub/sub) if you scale out.
- The redirect uses `302`. The target (`REDIRECT_URL`) is a plain static link
  you control.
