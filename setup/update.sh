#!/bin/bash
# Pull the latest version and rebuild. Run as root (the weekly timer does this).
set -euo pipefail
cd /opt/beeper-autoreply
git fetch --depth 1 origin main
if [ "$(git rev-parse HEAD)" = "$(git rev-parse FETCH_HEAD)" ]; then echo "up to date"; exit 0; fi
git reset --hard FETCH_HEAD
docker compose up -d --build
docker image prune -f >/dev/null
echo "updated to $(git rev-parse --short HEAD)"
