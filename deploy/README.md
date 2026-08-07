# Deploying IVS backend to EC2 (Node + PM2, no containers)

Target: Amazon Linux, Node 18+, code pulled with git, process managed by PM2,
nginx terminating TLS in front. MongoDB stays on Atlas.

## First-time server setup

```bash
sudo dnf install -y git nginx
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
sudo npm install -g pm2

git clone https://github.com/Nikhil321singh/Ivs_backend.git
cd Ivs_backend
npm ci --omit=dev
```

## Environment

`.env` is gitignored, so it never arrives from a `git pull` — create it on the
server once and edit it in place afterwards.

```bash
cp .env.example .env
nano .env
```

Required or the process exits on boot (see `REQUIRED_ENV_VARS` in
`src/config/env.js`): `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`MSG91_AUTH_KEY`, `MSG91_FLOW_ID`.

Server-specific values:

```
NODE_ENV=production
PORT=5000
API_BASE_URL=https://api.yourdomain.com    # no trailing slash; Swagger appends /api/v1
CLIENT_URL=https://app.yourdomain.com      # the web frontend origin, for CORS
```

Before TLS is set up, use `http://<EC2-public-IP>:5000` for `API_BASE_URL`.

## Start

```bash
mkdir -p logs
pm2 start ecosystem.config.js --env production
pm2 logs ivs-backend --lines 30
pm2 save
pm2 startup          # run the sudo command it prints, so it survives reboot
```

Healthy boot prints `MongoDB connected: <host>` then
`IVS backend running in production mode on port 5000`.

## Deploying an update

```bash
cd ~/Ivs_backend
git pull origin main
npm ci --omit=dev
pm2 restart ivs-backend --update-env    # --update-env re-reads .env
```

## nginx reverse proxy

`/etc/nginx/conf.d/ivs.conf`:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    client_max_body_size 10M;   # profile image uploads (UPLOAD_MAX_SIZE_MB)

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`X-Forwarded-For` matters: `app.set('trust proxy', 1)` in `src/app.js` expects
exactly one proxy hop, and the rate limiter keys on the client IP it yields.

```bash
sudo nginx -t && sudo systemctl enable --now nginx
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
```

Then close port 5000 in the security group and leave only 80/443 (and 22) open.

## Checks

```bash
curl localhost:5000/health           # on the box — app alive
curl localhost:5000/api/v1/health    # DB round-trip
curl https://api.yourdomain.com/health
```

Testing on-box first separates an app crash from a blocked security group.

## Networking notes

- Add the instance's public IP to the **MongoDB Atlas** IP access list.
- Attach an **Elastic IP** — a stop/start otherwise changes the public IP,
  breaking Atlas and any IP whitelisting at C-DOT CEIR, Paysprint or MSG91.
- Razorpay webhook URL: `https://api.yourdomain.com/api/v1/wallet/webhook/razorpay`
  (HTTPS required, so it waits on certbot).

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Script not found: .../index.js` | Entry point is `src/server.js`; use `ecosystem.config.js` |
| PM2 status `errored`, restart loop | Missing required env var — `pm2 logs` shows which |
| `MongoServerSelectionError` | EC2 IP not in the Atlas access list |
| Connection times out from laptop | Port not open in the security group |
| Env change had no effect | `pm2 restart` without `--update-env` |
