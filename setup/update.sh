#!/bin/bash
# Pull the latest worker code, rebuild and restart. Run as root (the weekly timer does this for you).
set -euo pipefail
cd /opt/beeper-autoreply
sudo -u beeper git fetch --depth 1 origin main
if [ "$(sudo -u beeper git rev-parse HEAD)" = "$(sudo -u beeper git rev-parse FETCH_HEAD)" ]; then echo "up to date"; exit 0; fi
sudo -u beeper git reset --hard FETCH_HEAD
cd server
sudo -u beeper npm ci --no-audit --no-fund
sudo -u beeper npm run build
sudo -u beeper npm prune --omit=dev
systemctl restart beeper-autoreply.service
echo "updated to $(sudo -u beeper git -C /opt/beeper-autoreply rev-parse --short HEAD)"
