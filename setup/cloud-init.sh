#!/bin/bash
# Beeper Auto-Reply — one-shot server setup for Oracle Cloud "Always Free" (Ubuntu 22.04/24.04, ARM or x86).
# Paste this whole file into Oracle's "Cloud-init script" box when you create the VM.
#
# ============ EDIT THESE LINES ON YOUR PHONE BEFORE PASTING ============
# Your access key: a long phrase only you know (12+ characters). You will type it into the control page.
CONTROL_SECRET="CHANGE-ME-to-a-long-private-phrase"
# Free open-source AI on the server itself (yes/no). "no" if you will use Groq/OpenRouter/Gemini instead.
INSTALL_OLLAMA="yes"
OLLAMA_MODEL="qwen2.5:3b"
# How the control page reaches this server: cloudflare (no account needed) | tailscale | none
TUNNEL="cloudflare"
# Only for TUNNEL="tailscale": an auth key from https://login.tailscale.com/admin/settings/keys
TAILSCALE_AUTHKEY=""
# =======================================================================
REPO_URL="https://github.com/Bobbykelvin11/beeper-autoreply.git"
REPO_BRANCH="main"
BEEPER_PORT=23374
API_PORT=8787

set -euo pipefail
exec > >(tee -a /var/log/beeper-autoreply-setup.log) 2>&1
echo "=== beeper-autoreply setup started $(date -Is) ==="
say() { echo "[setup] $*"; echo "[beeper-autoreply] $*" > /dev/console 2>/dev/null || true; }

if [ "${#CONTROL_SECRET}" -lt 12 ] || [[ "$CONTROL_SECRET" == CHANGE-ME* ]]; then
  say "ERROR: edit CONTROL_SECRET at the top of the script (12+ characters) and create the VM again."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
ARCH="$(uname -m)"; case "$ARCH" in aarch64|arm64) DEB_ARCH=arm64; FEED_ARCH=arm64 ;; *) DEB_ARCH=amd64; FEED_ARCH=x64 ;; esac

say "Installing base packages"
apt-get update -y
apt-get install -y curl git ca-certificates jq tar gzip

# Small machines: add swap so Beeper Server + Node + (optional) Ollama fit.
if ! swapon --show | grep -q swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Installing Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id beeper >/dev/null 2>&1 || useradd --create-home --shell /bin/bash beeper
BEEPER_HOME=/home/beeper
DATA_DIR=/var/lib/beeper-autoreply
mkdir -p "$DATA_DIR" && chown beeper:beeper "$DATA_DIR" && chmod 700 "$DATA_DIR"

say "Installing Beeper CLI + Beeper Server"
npm install -g beeper-cli || say "beeper-cli npm install failed; falling back to direct download"
SERVER_BIN="$BEEPER_HOME/.beeper/bin/beeper-server"
if command -v beeper >/dev/null; then
  sudo -u beeper -H beeper install server --channel stable || true
fi
if [ ! -x "$SERVER_BIN" ]; then
  # Fallback: the same official artifact the CLI downloads, from Beeper's update feed.
  FEED="https://api.beeper.com/desktop/update-feed.json?bundleID=com.automattic.beeper.server&platform=linux&channel=stable&arch=$FEED_ARCH"
  URL="$(curl -fsSL "$FEED" | jq -r '.url')"
  mkdir -p "$BEEPER_HOME/.beeper/apps/server" "$BEEPER_HOME/.beeper/bin"
  curl -fsSL "$URL" -o /tmp/beeper-server.tgz
  tar -xzf /tmp/beeper-server.tgz -C "$BEEPER_HOME/.beeper/apps/server"
  FOUND="$(find "$BEEPER_HOME/.beeper/apps/server" -type f -name beeper-server -perm -u+x | head -n1)"
  ln -sf "$FOUND" "$SERVER_BIN"
  chown -R beeper:beeper "$BEEPER_HOME/.beeper"
fi
SERVER_DATA="$BEEPER_HOME/.beeper/profiles/server/autoreply"
sudo -u beeper mkdir -p "$SERVER_DATA"

cat > /etc/systemd/system/beeper-server.service <<UNIT
[Unit]
Description=Beeper Server (headless Beeper for the auto-reply bot)
After=network-online.target
Wants=network-online.target

[Service]
User=beeper
Environment=BEEPER_SERVER_DATA_DIR=$SERVER_DATA
ExecStart=$SERVER_BIN --host=127.0.0.1 --port=$BEEPER_PORT --data-dir=$SERVER_DATA
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

if [ "$INSTALL_OLLAMA" = "yes" ]; then
  say "Installing Ollama (free local AI)"
  curl -fsSL https://ollama.com/install.sh | sh || say "Ollama install failed (you can use Groq/OpenRouter instead)"
fi

say "Installing the auto-reply worker"
rm -rf /opt/beeper-autoreply
git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" /opt/beeper-autoreply
cd /opt/beeper-autoreply/server
npm ci --no-audit --no-fund
npm run build
npm prune --omit=dev
chown -R beeper:beeper /opt/beeper-autoreply

AI_BASE_URL=""; AI_MODEL=""
if [ "$INSTALL_OLLAMA" = "yes" ] && command -v ollama >/dev/null; then AI_BASE_URL="http://127.0.0.1:11434/v1"; AI_MODEL="$OLLAMA_MODEL"; fi

PUBLIC_URL=""
if [ "$TUNNEL" = "tailscale" ] && [ -n "$TAILSCALE_AUTHKEY" ]; then
  say "Setting up Tailscale Funnel"
  curl -fsSL https://tailscale.com/install.sh | sh
  tailscale up --authkey="$TAILSCALE_AUTHKEY" --hostname=beeper-autoreply
  tailscale funnel --bg "$API_PORT"
  PUBLIC_URL="https://$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
fi

umask 077
cat > /etc/beeper-autoreply.env <<ENV
CONTROL_SECRET=$CONTROL_SECRET
PORT=$API_PORT
DATA_DIR=$DATA_DIR
BEEPER_BASE_URL=http://127.0.0.1:$BEEPER_PORT
PUBLIC_URL=$PUBLIC_URL
CLOUDFLARED_METRICS=127.0.0.1:20241
NTFY_URL=https://ntfy.sh
AI_BASE_URL=$AI_BASE_URL
AI_MODEL=$AI_MODEL
ENV
chown root:beeper /etc/beeper-autoreply.env && chmod 640 /etc/beeper-autoreply.env
umask 022

cat > /etc/systemd/system/beeper-autoreply.service <<UNIT
[Unit]
Description=Beeper AI auto-reply worker
After=network-online.target beeper-server.service
Wants=network-online.target beeper-server.service

[Service]
User=beeper
EnvironmentFile=/etc/beeper-autoreply.env
WorkingDirectory=/opt/beeper-autoreply/server
ExecStart=/usr/bin/node dist/src/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT

if [ "$TUNNEL" = "cloudflare" ]; then
  say "Installing Cloudflare quick tunnel (no account needed)"
  curl -fsSL -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$DEB_ARCH.deb"
  dpkg -i /tmp/cloudflared.deb
  cat > /etc/systemd/system/beeper-autoreply-tunnel.service <<UNIT
[Unit]
Description=Cloudflare quick tunnel for the auto-reply control API
After=network-online.target beeper-autoreply.service
Wants=network-online.target

[Service]
User=beeper
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:20241 --url http://127.0.0.1:$API_PORT
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
fi

systemctl daemon-reload
systemctl enable --now beeper-server.service
systemctl enable --now beeper-autoreply.service
[ "$TUNNEL" = "cloudflare" ] && systemctl enable --now beeper-autoreply-tunnel.service

if [ "$INSTALL_OLLAMA" = "yes" ] && command -v ollama >/dev/null; then
  say "Downloading AI model $OLLAMA_MODEL in the background (a few minutes)"
  (sleep 20; ollama pull "$OLLAMA_MODEL" >> /var/log/beeper-autoreply-setup.log 2>&1) &
fi

# Weekly auto-update of the worker (git pull + rebuild), so fixes arrive without SSH.
install -m 755 /opt/beeper-autoreply/setup/update.sh /usr/local/bin/beeper-autoreply-update
cat > /etc/systemd/system/beeper-autoreply-update.service <<UNIT
[Unit]
Description=Update the Beeper auto-reply worker
[Service]
Type=oneshot
ExecStart=/usr/local/bin/beeper-autoreply-update
UNIT
cat > /etc/systemd/system/beeper-autoreply-update.timer <<UNIT
[Unit]
Description=Weekly update of the Beeper auto-reply worker
[Timer]
OnCalendar=weekly
Persistent=true
RandomizedDelaySec=3h
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now beeper-autoreply-update.timer

say "DONE. Open your control page and sign in with your access key (give it ~2 minutes)."
echo "=== beeper-autoreply setup finished $(date -Is) ==="
