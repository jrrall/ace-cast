# Deploy Ace Cast on a $5 Linode (SQLite, single box)

The cheapest way to run Ace Cast: **SQLite on the same host as the app** — no separate
database server. This is the right-sized choice for now, because the app is already
**single-instance** (rooms live in memory), so a database server buys nothing until
multi-machine scale (S3, far off). Fits a **Nanode 1 GB ($5/mo)**.

Ready-to-use files in [`deploy/linode/`](../deploy/linode/):
`docker-compose.sqlite.yml`, `Caddyfile`, `.env.sqlite.example`.

**Validated locally** against real Docker: the app boots on SQLite, migrate+seed
creates `madlad-core` (268 cards), and — the thing that matters for SQLite — **data
survives container recreation** on the `acecast_data` volume (verified: a sentinel row
persisted across a full `down`/`up`, and the idempotent seed didn't duplicate).

> Prefer a managed database or plan to scale past one machine soon? Use the Postgres
> variant instead — see [`linode-deploy-runbook.md`](./linode-deploy-runbook.md).

---

## 0. What shapes this deploy

| Property | Consequence |
| --- | --- |
| **Rooms live in memory** | **One app container only.** Never scale replicas — a second instance can't see the first's rooms (this is also why Postgres isn't needed yet). |
| **SQLite file = the whole database** | It lives on the **`acecast_data` volume** mounted at `/app/data`. That volume is your data — back it up; the container is disposable. |
| **`start()` migrates + seeds on every boot**, idempotent | No manual step. Each `up`/restart self-migrates + re-seeds safely. |
| **SQLite is single-writer** | A non-issue at party-game scale: telemetry/flag writes are tiny and already serialised (`pool.max = 1`). |
| **`better-sqlite3` native dep** | Installs from a prebuilt Alpine binary during `docker build` — no toolchain needed (verified). |
| **`.dockerignore` excludes `data/`** | So a local dev DB never gets baked into the image (fixed in this branch). |

---

## 1. Prerequisites

- A Linode account and a **domain** you control (needed for HTTPS; a subdomain like
  `acecast.yourdomain.com` is fine).
- If you want card flagging in the playtest, deploy a commit that includes the
  **F2 flagging** feature (`feat/f2-card-flagging`). The Postgres seed fix isn't
  required here (that bug is Postgres-only), but it's harmless — keeping it costs nothing.

---

## 2. Create + harden the Linode

1. **Create**: Ubuntu 24.04 LTS, **Nanode 1 GB** ($5/mo), a region near your players,
   your SSH key. Note the public IPv4.
2. **DNS**: add an **A record** `acecast.yourdomain.com` → the IPv4. Confirm it resolves
   (`dig +short acecast.yourdomain.com`) before deploying, or Caddy's cert will fail.
3. **Harden** (as root):
   ```bash
   ssh root@<LINODE_IP>
   adduser deploy && usermod -aG sudo deploy
   rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
   apt update && apt -y upgrade
   ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
   ```
   Reconnect as `deploy`.

---

## 3. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy    # log out/in so the group applies
docker version && docker compose version
```

---

## 4. Code + config

```bash
git clone https://github.com/<you>/ace-cast.git
cd ace-cast              # deploy a commit with F2 if you want flagging
cd deploy/linode
cp .env.sqlite.example .env
nano .env
```
`.env` needs only two values (no database credentials):
```ini
SITE_ADDRESS=acecast.yourdomain.com
PUBLIC_URL=https://acecast.yourdomain.com
```

---

## 5. Launch

From `deploy/linode/`:
```bash
docker compose -f docker-compose.sqlite.yml up -d --build
```
Builds the app image, creates the `acecast_data` volume, boots the app (migrate+seed on
the SQLite file), and starts Caddy (fetches a TLS cert on first request).

```bash
docker compose -f docker-compose.sqlite.yml logs -f app     # "Ace Cast Server running on port 3000"
docker compose -f docker-compose.sqlite.yml logs -f caddy   # certificate obtained
```

---

## 6. Verify

```bash
# 6a. Health over HTTPS.
curl -s https://acecast.yourdomain.com/healthz
#   => {"status":"ok","db":true,"rooms":0,"uptime":…}

# 6b. Seed landed (query the SQLite file inside the app container via node).
docker compose -f docker-compose.sqlite.yml exec app \
  node -e "const {db}=require('./src/db');db()('cards').count({n:'*'}).first().then(r=>{console.log('cards:',Number(r.n));process.exit(0)})"
#   => cards: 268
```

**6c. Smoke-test a real game:** open `https://acecast.yourdomain.com/`, create a room,
join from a couple of phones, play a full MadLad round to a winner.

**6d. Flags/telemetry persist:** after tapping a flag on the results screen,
```bash
docker compose -f docker-compose.sqlite.yml exec app \
  node -e "const {db}=require('./src/db');db()('card_flags').orderBy('id','desc').limit(5).then(r=>{console.log(r);process.exit(0)})"
```

---

## 7. Acceptance checklist

- [ ] `docker compose -f docker-compose.sqlite.yml ps` shows `app` + `caddy` up; **one** `app`.
- [ ] `curl https://…/healthz` → 200, `db:true`.
- [ ] `cards` = 268.
- [ ] A full MadLad round played end-to-end over HTTPS.
- [ ] `card_flags` / `card_stats` rows exist after play.
- [ ] Data survives `docker compose ... down && up` (it lives on the volume).

---

## 8. Backups — just copy the file

SQLite's whole database is one file on the volume. Use the online-backup command so the
copy is consistent even while the app is writing (don't `cp` a live DB):

```bash
cd deploy/linode
# Consistent snapshot via better-sqlite3's .backup(), streamed to the host:
docker compose -f docker-compose.sqlite.yml exec -T app \
  node -e "const D=require('better-sqlite3')('/app/data/ace-cast.db'); D.backup('/app/data/backup.db').then(()=>{console.log('ok');process.exit(0)})"
docker compose -f docker-compose.sqlite.yml cp app:/app/data/backup.db ./acecast-$(date +%F).db
docker compose -f docker-compose.sqlite.yml exec -T app rm -f /app/data/backup.db
```
Copy `acecast-YYYY-MM-DD.db` off-box (scp / object storage). **Restore:** stop the app,
`docker compose cp ./backup.db app:/app/data/ace-cast.db`, start it. A nightly `cron` of
the block above is plenty for a playtest.

---

## 9. Operations

```bash
# From deploy/linode/ (all commands take -f docker-compose.sqlite.yml):
docker compose -f docker-compose.sqlite.yml logs -f app
docker compose -f docker-compose.sqlite.yml restart app
git pull && docker compose -f docker-compose.sqlite.yml up -d --build   # update; data on the volume survives
```

---

## 10. Troubleshooting

- **Caddy TLS fails** — DNS A record must resolve here before first request; ports 80/443
  open (`ufw status`); `logs caddy` shows the ACME error.
- **`/healthz` 503 (`db:false`)** — the SQLite file/volume is unwritable; `logs app` for the
  error; confirm the `acecast_data` volume mounted (`docker volume ls | grep acecast`).
- **Data vanished after a redeploy** — you almost certainly ran `down -v` (the `-v` deletes
  volumes) or didn't use the volume. Plain `down`/`up` preserves it.
- **WebSockets not connecting** — Caddy proxies them transparently; it's nearly always the
  TLS/domain issue above. Ensure the page is loaded over `https://`.
- **Sluggish under many concurrent rooms** — SQLite is single-writer; if you ever outgrow
  it, switch to the Postgres variant (same app, no code change). You'll hit the memory
  ceiling of a 1 GB box (resize to 2 GB) long before SQLite is the bottleneck at this scale.

---

## 11. Accounts (E4) — Authelia forward-auth

Accounts are **prod-only** and gate **only** `/account*` (and `/admin*`). Gameplay is
never touched: guests still create/join rooms and play with just a name + their device
identity. Locally you don't run Authelia at all — `AUTH_PROVIDER` defaults to `dev`, which
serves an in-app `/login` form. In this deploy the app runs with `AUTH_PROVIDER=forward`
and trusts the `Remote-*` headers Caddy forwards from Authelia.

**Why Authelia (not authentik):** it's a *single* lightweight service (local file users +
SQLite storage, ~30-50 MB RSS). authentik needs Postgres + Redis + a worker, which would
blow the 1 GB Nanode's memory budget next to app + Caddy + SQLite.

Files (in [`deploy/linode/`](../deploy/linode/)):
`docker-compose.sqlite.yml` (the `authelia` service), `Caddyfile` (the `forward_auth`
block), and `authelia/configuration.yml` + `authelia/users_database.yml` (examples).

### 11a. Set the secrets

In `deploy/linode/.env` (copied from `.env.sqlite.example`), fill four secrets — generate
each with `openssl rand -hex 32`, **never commit them**:

```ini
AUTH_SESSION_SECRET=<random>              # the app's own login-session cookie
AUTHELIA_JWT_SECRET=<random>
AUTHELIA_SESSION_SECRET=<random>
AUTHELIA_STORAGE_ENCRYPTION_KEY=<random>
```

### 11b. Add a user

Edit `deploy/linode/authelia/users_database.yml`. The shipped entry is an **example** with
a placeholder hash — replace it. Generate a real argon2id hash on the box:

```bash
cd deploy/linode
docker compose -f docker-compose.sqlite.yml run --rm authelia \
  authelia crypto hash generate argon2 --password 'your-strong-password'
```

Paste the `$argon2id$...` string as the user's `password`, set `email` (this is what the
app receives as `Remote-Email` and keys the account on), then bring the stack up:

```bash
docker compose -f docker-compose.sqlite.yml up -d --build
```

### 11c. The forward-auth flow

1. A player hits `https://<domain>/account`.
2. Caddy's `forward_auth` asks Authelia (`/api/verify`). Unauthenticated → redirect to the
   Authelia portal (served under `/authelia`).
3. After sign-in Authelia approves the verify request and returns
   `Remote-User / Remote-Email / Remote-Name / Remote-Groups`; Caddy `copy_headers` copies
   them onto the upstream request to the app.
4. The app (`ForwardAuthProvider`) reads `Remote-Email`, upserts the `users` row, issues its
   own signed session cookie, and **links the current device identity** to the account
   (`identities.user_id`) so future durable stats attach to it. `/account` renders.

**Security boundary:** the app trusts `Remote-*` **only** because `TRUST_PROXY=true` and the
headers arrive via Caddy. Those headers are spoofable if the app port is reachable directly,
so the app never reads them when un-proxied (locally `AUTH_PROVIDER=dev` ignores them
entirely). Keep the app on the internal Docker network (`expose`, not `ports`) — only Caddy
is published. Every non-gated path stays public, so gameplay never requires a login.

**RAM footprint:** the `authelia` container adds roughly **30-50 MB** RSS — comfortable on
the 1 GB Nanode next to app + Caddy + SQLite. (Resize to 2 GB only if you later add heavy
services; Authelia itself won't push you there.)

---

**Golden rule:** one `app` container, and the `acecast_data` volume *is* your database —
back it up. Moving to Postgres later is a config swap (`DATABASE_URL`), not a rewrite.
