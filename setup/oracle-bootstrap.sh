#!/bin/bash
# Beeper Auto-Reply: one-VM install for Oracle Cloud Always Free (Ubuntu 22.04/24.04, ARM or AMD).
# Installs Docker, then runs web UI + API + Beeper bridges + auto-reply (+ optional free AI) with HTTPS.
#
# You normally don't edit this file. Paste the 3-line starter from setup/README-phone.md into Oracle's
# "Cloud-init script" box; it sets your access key and runs this script.
#
# Settings (environment variables set by the starter):
#   CONTROL_SECRET       required. Your access key (12+ characters). You type it on the sign-in page.
#   DUCKDNS_SUBDOMAIN    optional. Use name.duckdns.org instead of <ip>.sslip.io (needs DUCKDNS_TOKEN)
#   DUCKDNS_TOKEN        optional. Only used once to point the name at this VM; never stored.
#   INSTALL_OLLAMA       optional. auto (default: on for ARM VMs with 8GB+ RAM) | yes | no
#   OLLAMA_MODEL         optional. Default qwen2.5:3b
#   REPO_BRANCH          optional. Default main
set -euo pipefail
exec > >(tee -a /var/log/beeper-autoreply-setup.log) 2>&1
echo "=== beeper-autoreply setup started $(date -Is) ==="

REPO_URL="${REPO_URL:-https://github.com/Bobbykelvin11/beeper-autoreply.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_DIR=/opt/beeper-autoreply
INSTALL_OLLAMA="${INSTALL_OLLAMA:-auto}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"
CONTROL_SECRET="${CONTROL_SECRET:-}"

if [ "${#CONTROL_SECRET}" -lt 12 ] || [[ "$CONTROL_SECRET" == *CHANGE* ]]; then
  echo "ERROR: CONTROL_SECRET must be 12+ characters. Create the VM again with your own access key in the starter script."
  exit 1
fi
if [[ "$CONTROL_SECRET" =~ [\"\'\\\$\`[:space:]] ]]; then
  echo "ERROR: the access key may only contain letters, numbers and - _ . (no spaces or quotes)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
ARCH=$(uname -m)

echo "[1/7] Packages and swap (RAM ${MEM_MB} MB, arch ${ARCH})"
apt-get update -y
apt-get install -y ca-certificates curl git jq openssl iptables
if ! swapon --show | grep -q swapfile; then
  SWAP=4G; [ "$MEM_MB" -lt 2048 ] && SWAP=3G
  fallocate -l "$SWAP" /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "[2/7] Opening ports 80/443 in the VM firewall"
# Oracle's Ubuntu images ship an iptables rule set that rejects everything except SSH.
cat > /usr/local/sbin/beeper-autoreply-firewall <<'FW'
#!/bin/sh
for rule in "-p tcp --dport 80" "-p tcp --dport 443" "-p udp --dport 443"; do
  # shellcheck disable=SC2086
  iptables -C INPUT $rule -j ACCEPT 2>/dev/null || iptables -I INPUT 1 $rule -j ACCEPT
done
FW
chmod +x /usr/local/sbin/beeper-autoreply-firewall
cat > /etc/systemd/system/beeper-autoreply-firewall.service <<'UNIT'
[Unit]
Description=Open web ports for Beeper Auto-Reply
After=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/beeper-autoreply-firewall
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now beeper-autoreply-firewall.service

echo "[3/7] Docker"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
systemctl enable --now docker
docker compose version

echo "[4/7] Web address (HTTPS needs a name)"
IP=""
for u in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
  IP=$(curl -4 -fsS --max-time 10 "$u" 2>/dev/null | tr -d '[:space:]') && [[ "$IP" =~ ^[0-9.]+$ ]] && break || IP=""
done
[ -n "$IP" ] || { echo "ERROR: could not detect the public IP. Does the VM have a public IPv4 address?"; exit 1; }
if [ -n "${DUCKDNS_SUBDOMAIN:-}" ] && [ -n "${DUCKDNS_TOKEN:-}" ]; then
  DOMAIN="${DUCKDNS_SUBDOMAIN}.duckdns.org"
  curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=${IP}" | grep -q OK || echo "WARNING: DuckDNS update failed; check subdomain/token."
else
  DOMAIN="${IP//./-}.sslip.io"
fi
echo "Public IP $IP, address https://$DOMAIN"

echo "[5/7] Getting the app"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$REPO_BRANCH" && git -C "$APP_DIR" reset --hard FETCH_HEAD
else
  rm -rf "$APP_DIR"
  git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

echo "[6/7] Writing settings (secrets stay on this VM)"
case "$INSTALL_OLLAMA" in
  yes) USE_OLLAMA=1 ;;
  no) USE_OLLAMA=0 ;;
  *) if [ "$ARCH" = aarch64 ] && [ "$MEM_MB" -ge 8000 ]; then USE_OLLAMA=1; else USE_OLLAMA=0; fi ;;
esac
SESSION_KEY=""
[ -f .env ] && SESSION_KEY=$(grep -E '^SESSION_KEY=' .env | cut -d= -f2- || true)
[ -n "$SESSION_KEY" ] || SESSION_KEY=$(openssl rand -hex 32)
umask 077
{
  echo "DOMAIN=$DOMAIN"
  echo "CONTROL_SECRET=$CONTROL_SECRET"
  echo "SESSION_KEY=$SESSION_KEY"
  if [ "$USE_OLLAMA" = 1 ]; then
    echo "COMPOSE_PROFILES=ollama"
    echo "AI_BASE_URL=http://127.0.0.1:11434/v1"
    echo "AI_MODEL=$OLLAMA_MODEL"
  fi
} > .env
umask 022
chmod 600 .env

echo "[7/7] Building and starting (10-25 minutes the first time)"
docker compose up -d --build
if [ "$USE_OLLAMA" = 1 ]; then
  (
    for _ in $(seq 1 60); do docker compose exec -T ollama ollama list >/dev/null 2>&1 && break; sleep 5; done
    docker compose exec -T ollama ollama pull "$OLLAMA_MODEL"
  ) >> /var/log/beeper-autoreply-setup.log 2>&1 &
fi

# Weekly self-update (git pull + rebuild).
install -m 755 "$APP_DIR/setup/update.sh" /usr/local/bin/beeper-autoreply-update
cat > /etc/systemd/system/beeper-autoreply-update.service <<'UNIT'
[Unit]
Description=Update Beeper Auto-Reply
[Service]
Type=oneshot
ExecStart=/usr/local/bin/beeper-autoreply-update
UNIT
cat > /etc/systemd/system/beeper-autoreply-update.timer <<'UNIT'
[Unit]
Description=Weekly update of Beeper Auto-Reply
[Timer]
OnCalendar=weekly
Persistent=true
RandomizedDelaySec=3h
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now beeper-autoreply-update.timer

echo "$DOMAIN" > "$APP_DIR/.domain"
echo "=== DONE $(date -Is). Open https://$DOMAIN and sign in with your access key. ==="
wait
