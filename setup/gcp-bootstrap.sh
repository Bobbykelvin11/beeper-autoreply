#!/bin/bash
# Beeper Auto-Reply: Google Cloud Always Free e2-micro (Debian 12 or Ubuntu 22.04/24.04, x86_64).
# Installs Docker, then runs the web UI + API + Beeper bridges + auto-reply with HTTPS (Caddy + sslip.io).
#
# Safe to use as a GCE startup-script (metadata key startup-script): it runs on every boot.
# The first boot does the full install; later boots only refresh settings and start the stack.
#
# Access key (CONTROL_SECRET), 12+ characters:
#   - Preferred: GCE custom metadata key "control-secret"
#     (http://metadata.google.internal/computeMetadata/v1/instance/attributes/control-secret
#      with header Metadata-Flavor: Google)
#   - Or export CONTROL_SECRET before running this script
#
# Optional environment variables:
#   DUCKDNS_SUBDOMAIN / DUCKDNS_TOKEN   use name.duckdns.org instead of <ip>.sslip.io
#   REPO_BRANCH                         default main
# A 1 GB e2-micro cannot run Ollama; set a free Groq key in the app's Settings after install.
set -euo pipefail
mkdir -p /var/log /var/lock /var/lib/beeper-autoreply
exec > >(tee -a /var/log/beeper-autoreply-setup.log) 2>&1
echo "=== beeper-autoreply GCP setup $(date -Is) ==="

exec 9>/var/lock/beeper-autoreply-setup.lock
if ! flock -n 9; then
  echo "Another setup run is already in progress; exiting."
  exit 0
fi

REPO_URL="${REPO_URL:-https://github.com/Bobbykelvin11/beeper-autoreply.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/beeper-autoreply}"
MARKER=/var/lib/beeper-autoreply/installed
METADATA_BASE="${METADATA_BASE:-http://metadata.google.internal/computeMetadata/v1}"

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# Read the access key from GCE instance metadata when it was not exported.
read_control_secret() {
  if [ -n "${CONTROL_SECRET:-}" ]; then
    return 0
  fi
  local url="${METADATA_URL:-${METADATA_BASE}/instance/attributes/control-secret}" val=""
  for _ in 1 2 3 4 5 6; do
    val=$(curl -fsS -H 'Metadata-Flavor: Google' --max-time 5 "$url" 2>/dev/null | tr -d '\r\n' || true)
    if [ -n "$val" ]; then
      CONTROL_SECRET=$val
      return 0
    fi
    sleep 2
  done
  return 1
}

validate_secret() {
  if [ "${#CONTROL_SECRET}" -lt 12 ] || [[ "$CONTROL_SECRET" == *CHANGE* ]]; then
    echo "ERROR: CONTROL_SECRET must be 12+ characters. Set the VM metadata key control-secret (or export CONTROL_SECRET) to your own access key."
    exit 1
  fi
  if [[ "$CONTROL_SECRET" =~ [\"\'\\\$\`[:space:]] ]]; then
    echo "ERROR: the access key may only contain letters, numbers and - _ . (no spaces or quotes)."
    exit 1
  fi
}

# 2 GB swap, required on the 1 GB e2-micro.
ensure_swap() {
  [ "${BOOTSTRAP_SKIP_SWAP:-}" = 1 ] && return 0
  if swapon --show | grep -q swapfile; then
    echo "Swap already on"
    return 0
  fi
  if [ ! -f /swapfile ]; then
    echo "Creating 2 GB swapfile"
    if ! fallocate -l 2G /swapfile 2>/dev/null; then
      dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    fi
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  mkdir -p /etc/sysctl.d
  echo 'vm.swappiness=80' > /etc/sysctl.d/99-beeper-autoreply.conf
  sysctl -w vm.swappiness=80 >/dev/null || true
}

# GCP's real firewall is the VPC rule from the http-server / https-server network tags.
# Still open the ports on the guest if a host firewall is active.
ensure_host_firewall() {
  [ "${BOOTSTRAP_SKIP_FIREWALL:-}" = 1 ] && return 0
  if need_cmd ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 80/tcp || true
    ufw allow 443/tcp || true
    ufw allow 443/udp || true
  fi
  if need_cmd iptables; then
    local rule
    for rule in "-p tcp --dport 80" "-p tcp --dport 443" "-p udp --dport 443"; do
      # shellcheck disable=SC2086
      iptables -C INPUT $rule -j ACCEPT 2>/dev/null || iptables -I INPUT 1 $rule -j ACCEPT || true
    done
  fi
}

public_ip() {
  if [ -n "${BOOTSTRAP_IP:-}" ]; then
    echo "$BOOTSTRAP_IP"
    return 0
  fi
  local ip u
  ip=$(curl -fsS -H 'Metadata-Flavor: Google' --max-time 5 \
    "${METADATA_BASE}/instance/network-interfaces/0/access-configs/0/external-ip" 2>/dev/null | tr -d '\r\n' || true)
  if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "$ip"
    return 0
  fi
  for u in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip=$(curl -4 -fsS --max-time 10 "$u" 2>/dev/null | tr -d '[:space:]' || true)
    if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "$ip"
      return 0
    fi
  done
  return 1
}

write_env() {
  local domain=$1 session_key=""
  if [ -f "$APP_DIR/.env" ]; then
    session_key=$(grep -E '^SESSION_KEY=' "$APP_DIR/.env" | cut -d= -f2- || true)
  fi
  [ -n "$session_key" ] || session_key=$(openssl rand -hex 32)
  umask 077
  cat > "$APP_DIR/.env" <<ENV
DOMAIN=${domain}
CONTROL_SECRET=${CONTROL_SECRET}
SESSION_KEY=${session_key}
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=openai/gpt-oss-120b
ENV
  umask 022
  chmod 600 "$APP_DIR/.env"
}

install_timer() {
  [ "${BOOTSTRAP_SKIP_SYSTEMD:-}" = 1 ] && return 0
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
}

start_stack() {
  [ "${BOOTSTRAP_SKIP_DOCKER:-}" = 1 ] && return 0
  cd "$APP_DIR"
  # No --build on later boots: a 1 GB VM should not rebuild images every time it starts.
  docker compose up -d
}

refresh_settings() {
  local ip domain
  ip=$(public_ip) || { echo "ERROR: could not detect the public IP."; exit 1; }
  if [ -n "${DUCKDNS_SUBDOMAIN:-}" ] && [ -n "${DUCKDNS_TOKEN:-}" ]; then
    domain="${DUCKDNS_SUBDOMAIN}.duckdns.org"
    curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=${ip}" | grep -q OK \
      || echo "WARNING: DuckDNS update failed; check subdomain/token."
  else
    domain="${ip//./-}.sslip.io"
  fi
  echo "Public IP $ip, address https://$domain"
  write_env "$domain"
  echo "$domain" > "$APP_DIR/.domain"
  ensure_host_firewall
}

# --- main ---
export DEBIAN_FRONTEND=noninteractive
read_control_secret || true
validate_secret

MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
ARCH=$(uname -m)
echo "RAM ${MEM_MB} MB, arch ${ARCH}"

if [ "${BOOTSTRAP_SKIP_APT:-}" != 1 ]; then
  echo "[1/6] Packages and 2 GB swap"
  apt-get update -y
  apt-get install -y ca-certificates curl git jq openssl iptables
else
  echo "[1/6] Skipping apt (test mode); ensuring swap if permitted"
fi
ensure_swap

echo "[2/6] Host firewall (VPC tags http-server and https-server must also be set)"
ensure_host_firewall

if [ "${BOOTSTRAP_SKIP_DOCKER:-}" != 1 ]; then
  echo "[3/6] Docker"
  if ! need_cmd docker; then
    curl -fsSL https://get.docker.com | sh
  fi
  if [ "${BOOTSTRAP_SKIP_SYSTEMD:-}" != 1 ]; then
    systemctl enable --now docker
  fi
  docker compose version
else
  echo "[3/6] Skipping Docker (test mode)"
fi

already=0
if [ -f "$MARKER" ] && [ -d "$APP_DIR/.git" ] && [ -f "$APP_DIR/.env" ]; then
  already=1
elif [ "${BOOTSTRAP_SKIP_DOCKER:-}" = 1 ] && [ -d "$APP_DIR/.git" ] && [ -f "$APP_DIR/.env" ]; then
  already=1
fi

if [ "$already" = 1 ]; then
  echo "[4/6] Already installed; refreshing address and starting services"
  refresh_settings
  start_stack
  echo "=== READY $(date -Is). Open https://$(cat "$APP_DIR/.domain") and sign in with your access key. ==="
  exit 0
fi

echo "[4/6] Getting the app"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$REPO_BRANCH" && git -C "$APP_DIR" reset --hard FETCH_HEAD
else
  rm -rf "$APP_DIR"
  git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
fi

echo "[5/6] Writing settings (secrets stay on this VM; session key is generated here)"
mkdir -p "$APP_DIR"
refresh_settings

echo "[6/6] Building and starting (20-40 minutes the first time on e2-micro)"
if [ "${BOOTSTRAP_SKIP_DOCKER:-}" != 1 ]; then
  cd "$APP_DIR"
  export COMPOSE_PARALLEL_LIMIT=1
  docker compose build --parallel 1
  docker compose up -d
fi
install_timer
date -Is > "$MARKER"
echo "=== DONE $(date -Is). Open https://$(cat "$APP_DIR/.domain") and sign in with your access key. ==="
echo "On this 1 GB VM, add a free Groq API key in Settings before turning the bot on."
