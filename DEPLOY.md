# Deploying Ace Cast

Ace Cast is a single Node.js process (Express + Socket.IO) that keeps game rooms
**in memory**. That means it must run as **one always-on instance** with support
for persistent WebSocket connections. Plain static/serverless hosting will not
work; a small container VM will.

> Scaling note: because rooms are in memory, do **not** run more than one
> instance yet. Horizontal scaling requires the Socket.IO Redis adapter + sticky
> sessions (tracked as a follow-up). One small VM comfortably handles many
> concurrent party rooms.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port the server listens on. |
| `PUBLIC_URL` | _(derived from request)_ | Canonical base URL for join/TV links + QR codes, e.g. `https://ace-cast.fly.dev`. Set this in production for stable links. |
| `TRUST_PROXY` | `true` | Trust `X-Forwarded-*` from the platform proxy (needed for correct https links + client IPs). Set `false` only for direct/local runs. |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS allowlist, e.g. `https://ace-cast.fly.dev`. Leave `*` while testing. |
| `MAX_PLAYERS_PER_ROOM` | `12` | Cap on players per room. |
| `MAX_ROOMS` | `500` | Cap on concurrent rooms (capacity guard). |

Health check endpoint: `GET /healthz` → `{ "status": "ok", ... }`.

## Option A — Fly.io (recommended, cheapest always-on)

```bash
# One-time
fly launch --no-deploy          # creates the app; keep the generated app name
fly secrets set PUBLIC_URL=https://<your-app>.fly.dev

# Deploy (uses Dockerfile + fly.toml in this repo)
fly deploy
```

Edit `app = "..."` in `fly.toml` to a unique name first. A single
`shared-cpu-1x` / 256MB machine is plenty to start and costs a few dollars/month.

## Option B — Render

1. New → **Web Service** → connect this repo.
2. Environment: **Docker** (uses the `Dockerfile`).
3. Set env vars from the table above (at minimum `PUBLIC_URL`).
4. Instances: **1**. Health check path: `/healthz`.

## Option C — Railway

1. New Project → Deploy from repo (Railway detects the `Dockerfile`).
2. Add the env vars above; set `PUBLIC_URL` to the generated domain.
3. Keep replicas at **1**.

## Local production test

```bash
docker build -t ace-cast .
docker run -p 3000:3000 -e TRUST_PROXY=false ace-cast
# open http://localhost:3000
```

## Casting to a TV (current model)

The TV view (`/tv/<CODE>`) is a plain URL with no private input, so it can be:
- **Chromecast**: cast the browser tab showing the TV URL (Chrome on desktop/Android).
- **Smart TV / Fire TV browser**: open the TV URL directly.
- **Screen mirroring (Miracast/AirPlay)**: mirror a device that has the TV URL open.

A native **Roku** channel (BrightScript/SceneGraph) is the planned future client;
it will talk to this same backend.
