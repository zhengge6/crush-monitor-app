#!/usr/bin/env bash
# Install crush-monitor to /opt/crush-monitor and enable systemd.
# Run as root on the target host. Does NOT write real API keys.
set -euo pipefail

SRC="${1:-.}"
DEST="${DEST:-/opt/crush-monitor}"
PORT="${PORT:-3178}"
HOST="${HOST:-0.0.0.0}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run as root (or with sudo)." >&2
  exit 1
fi

command -v node >/dev/null || { echo "Node.js is required (>=22.12 recommended)." >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required." >&2; exit 1; }
command -v rsync >/dev/null || { echo "rsync is required." >&2; exit 1; }

mkdir -p "$DEST"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.env' \
  "$SRC"/ "$DEST"/

cd "$DEST"

# Keep tsx (devDependency) available for `npm start` = tsx server/index.ts
npm ci
npm run build

if [[ ! -f .env ]]; then
  cat > .env <<ENV
# Optional server-side key — leave blank so users enter keys in the UI.
JEV_PROVIDER=typesafe
JEV_API_KEY=
PORT=${PORT}
HOST=${HOST}
ENV
  echo "Wrote placeholder .env (no API key)."
else
  # Ensure bind settings exist without overwriting a real key
  grep -q '^HOST=' .env || echo "HOST=${HOST}" >> .env
  grep -q '^PORT=' .env || echo "PORT=${PORT}" >> .env
fi

install -m 644 deploy/crush-monitor.service /etc/systemd/system/crush-monitor.service
systemctl daemon-reload
systemctl enable crush-monitor.service
systemctl restart crush-monitor.service

# Best-effort firewall open (firewalld or ufw)
if command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="${PORT}/tcp" || true
  firewall-cmd --reload || true
elif command -v ufw >/dev/null 2>&1; then
  ufw allow "${PORT}/tcp" || true
fi

echo "Installed. Health: http://${HOST}:${PORT}/api/health"
systemctl --no-pager --full status crush-monitor.service || true
