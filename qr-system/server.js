'use strict';

/**
 * Single-use, self-refreshing QR code system — BACKEND.
 *
 * How it works
 * ------------
 * - There is exactly ONE "active" token at any time (the QR currently on the
 *   display). Its value is a cryptographically random string.
 * - The display page renders a QR encoding `${PUBLIC_BASE_URL}/verify?token=…`.
 * - When a phone scans it and opens that URL:
 *     • valid + active   → the token is marked "used" atomically, a brand-new
 *       token is generated, every connected display is pushed the new QR over
 *       SSE, and the phone is 302-redirected to REDIRECT_URL.
 *     • invalid / used / expired → an "Expired QR Code" page is shown.
 * - The token also auto-rotates on a TTL timer, so a QR left un-scanned still
 *   refreshes itself (the "self-refreshing" part) and can't be reused later.
 *
 * Real-time channel: Server-Sent Events (GET /events). One-way server→browser
 * push is all the display needs, and the browser's built-in EventSource needs
 * no extra library. A polling endpoint (GET /api/current) is provided as a
 * fallback for clients that prefer short-polling.
 *
 * Storage is in-memory (a Map) as requested — restart clears everything.
 */

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

// ── Config (override via environment variables) ─────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 4000;
const TOKEN_TTL_MS = parseInt(process.env.TOKEN_TTL_MS, 10) || 60_000; // 60s

// Where the phone is sent after a successful scan.
// Override with REDIRECT_URL in the environment if needed.
const REDIRECT_URL = process.env.REDIRECT_URL || 'https://p.blre.cc/DFlOpe';

// The public origin used to build the URL encoded INTO the QR. For a phone to
// reach it, this must be a LAN IP (e.g. http://192.168.1.20:4000) or a public
// URL — NOT "localhost", which only resolves on the display machine itself.
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

// ── In-memory token store ───────────────────────────────────────────────────
// token -> { status: 'active' | 'used' | 'expired', createdAt, expiresAt }
const tokens = new Map();
let currentToken = null;
let rotateTimer = null;

// Connected SSE display clients (their response streams).
const clients = new Set();

const genToken = () => crypto.randomBytes(24).toString('hex');

const verifyUrlFor = (token) => `${PUBLIC_BASE_URL}/verify?token=${token}`;

const currentPayload = () => {
  const entry = tokens.get(currentToken);
  return {
    token: currentToken,
    verifyUrl: verifyUrlFor(currentToken),
    expiresAt: entry ? entry.expiresAt : null,
    ttlMs: TOKEN_TTL_MS,
  };
};

/** Push the current QR to every connected display. */
const broadcast = () => {
  const data = JSON.stringify(currentPayload());
  for (const res of clients) {
    res.write(`event: token\ndata: ${data}\n\n`);
  }
};

/**
 * Retire the current token and mint a fresh one, then notify all displays.
 * `reason` is just for logging ('init' | 'scanned' | 'ttl').
 */
const rotate = (reason) => {
  const prev = currentToken && tokens.get(currentToken);
  if (prev && prev.status === 'active') prev.status = 'expired';

  const token = genToken();
  const now = Date.now();
  tokens.set(token, { status: 'active', createdAt: now, expiresAt: now + TOKEN_TTL_MS });
  currentToken = token;

  clearTimeout(rotateTimer);
  rotateTimer = setTimeout(() => rotate('ttl'), TOKEN_TTL_MS);

  // eslint-disable-next-line no-console
  console.log(`[qr] rotated (${reason}) -> ${token.slice(0, 8)}… (${clients.size} display(s))`);
  broadcast();
  return token;
};

/** Occasionally drop long-dead tokens so the Map doesn't grow unbounded. */
const sweep = () => {
  const cutoff = Date.now() - 10 * TOKEN_TTL_MS;
  for (const [token, entry] of tokens) {
    if (token !== currentToken && entry.expiresAt < cutoff) tokens.delete(token);
  }
};
setInterval(sweep, 60_000).unref();

// ── App ─────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors()); // display frontend runs on its own origin
app.disable('x-powered-by');

// Root: quick description of the API.
app.get('/', (req, res) => {
  res.json({
    name: 'Single-use self-refreshing QR backend',
    endpoints: {
      'GET /events': 'SSE stream — pushes the current QR and every refresh',
      'GET /api/current': 'Returns the current token + verifyUrl (polling fallback)',
      'GET /verify?token=': 'Scan target — consumes the token and redirects, or shows expired',
      'GET /health': 'Liveness probe',
    },
    redirectUrl: REDIRECT_URL,
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

/**
 * SSE stream for the display. On connect it immediately receives the current
 * QR, then a `token` event every time the QR rotates (scan or TTL).
 */
app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  clients.add(res);
  res.write(`event: token\ndata: ${JSON.stringify(currentPayload())}\n\n`);

  // Heartbeat comment keeps the connection alive through proxies.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

/** Polling fallback: the current QR to render. */
app.get('/api/current', (req, res) => res.json(currentPayload()));

/**
 * The scan target. Single-use is guaranteed because the validity check and the
 * status flip happen synchronously (no await between them), so a second scan of
 * the same QR always sees status 'used'.
 */
app.get('/verify', (req, res) => {
  const { token } = req.query;
  const entry = typeof token === 'string' ? tokens.get(token) : null;
  const isValid = !!entry && entry.status === 'active' && Date.now() <= entry.expiresAt;

  if (!isValid) {
    return res.status(410).type('html').send(expiredPage());
  }

  entry.status = 'used'; // consume immediately — atomic vs. concurrent scans
  rotate('scanned'); // mint + broadcast a fresh QR so the display refreshes now
  return res.redirect(302, REDIRECT_URL);
});

function expiredPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Expired QR Code</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center;
      font-family:-apple-system,Segoe UI,Roboto,sans-serif; background:#0f172a; color:#e2e8f0; }
    .card { text-align:center; padding:2rem 2.5rem; background:#1e293b; border-radius:16px;
      box-shadow:0 10px 40px rgba(0,0,0,.4); max-width:340px; }
    .x { font-size:3rem; line-height:1; }
    h1 { font-size:1.25rem; margin:.75rem 0 .25rem; }
    p { margin:0; color:#94a3b8; font-size:.95rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="x">⛔</div>
    <h1>Expired QR Code</h1>
    <p>This code has already been used or has expired. Please scan the latest QR code on the screen.</p>
  </div>
</body>
</html>`;
}

// ── Boot ────────────────────────────────────────────────────────────────────
rotate('init');
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[qr] backend on http://localhost:${PORT}`);
  console.log(`[qr] QR encodes: ${verifyUrlFor(currentToken)}`);
  console.log(`[qr] redirect on success -> ${REDIRECT_URL}`);
  if (PUBLIC_BASE_URL.includes('localhost')) {
    console.warn('[qr] WARNING: PUBLIC_BASE_URL is localhost — phones cannot scan it. Set a LAN IP or public URL.');
  }
});

module.exports = app; // exported for testing
