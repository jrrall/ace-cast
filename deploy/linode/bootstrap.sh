#!/usr/bin/env bash
#
# Ace Cast — one-shot server bootstrap for a fresh Ubuntu 24.04 Linode (SQLite stack).
#
# Runs everything on the box: system update, firewall, Docker, clone, and launch the
# SQLite Compose stack behind Caddy (auto-HTTPS). Idempotent — safe to re-run to update.
#
# Use it either way:
#   A) After creating the Linode, from your laptop:
#        ssh root@<LINODE_IP> "DOMAIN=unholy.cards REPO_URL=https://github.com/<you>/ace-cast.git GIT_REF=main bash -s" < bootstrap.sh
#   B) As a Linode StackScript: paste this file, set the vars below, deploy at create time.
#
# NOTE: point your domain's A record at this box's IP. Caddy will keep retrying the TLS
# cert until DNS resolves, so order isn't fatal — but DNS-first is cleaner.
set -euo pipefail

# ---- configure (or pass as env vars) --------------------------------------
DOMAIN="${DOMAIN:-unholy.cards}"
REPO_URL="${REPO_URL:-https://github.com/CHANGE-ME/ace-cast.git}"
GIT_REF="${GIT_REF:-main}"          # branch/tag/sha to deploy (include F2 for flagging)
APP_DIR="${APP_DIR:-/opt/ace-cast}"
# ---------------------------------------------------------------------------

log() { echo ">> $*"; }

log "system update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y git ca-certificates curl ufw

log "firewall: ssh + web only"
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true

log "docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

log "clone / update repo at $APP_DIR (ref: $GIT_REF)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout "$GIT_REF"
  git -C "$APP_DIR" pull --ff-only origin "$GIT_REF" || true
else
  git clone "$REPO_URL" "$APP_DIR"
  git -C "$APP_DIR" checkout "$GIT_REF"
fi

log "write deploy/.env (domain only — no secrets for the SQLite stack)"
cat > "$APP_DIR/deploy/linode/.env" <<EOF
SITE_ADDRESS=$DOMAIN
PUBLIC_URL=https://$DOMAIN
EOF

log "launch SQLite stack (build + up)"
cd "$APP_DIR/deploy/linode"
docker compose -f docker-compose.sqlite.yml up -d --build

log "waiting for the app to answer locally..."
for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:80/healthz" >/dev/null 2>&1 \
     || docker compose -f docker-compose.sqlite.yml exec -T app \
          node -e "require('http').get('http://localhost:3000/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" >/dev/null 2>&1; then
    log "app is up"
    break
  fi
  sleep 2
done

cat <<EOF

Ace Cast bootstrapped.
  Domain : $DOMAIN   (ensure its A record points at this box's public IP)
  Check  : curl -s https://$DOMAIN/healthz   ->  {"status":"ok","db":true,...}
  Logs   : cd $APP_DIR/deploy/linode && docker compose -f docker-compose.sqlite.yml logs -f
Caddy fetches the TLS cert on first request once DNS resolves; give it a minute.
EOF
