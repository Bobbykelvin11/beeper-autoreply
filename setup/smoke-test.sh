#!/bin/bash
# End-to-end check of the docker compose stack on one machine (used by CI): Caddy -> web -> worker -> Beeper Server.
set -euo pipefail
cd "$(dirname "$0")/.."
cat > .env <<ENV
DOMAIN=localhost
CONTROL_SECRET=ci-access-key-123456
SESSION_KEY=$(openssl rand -hex 32)
ENV
trap 'docker compose logs --no-color --tail=60 || true' ERR
docker compose up -d --build
for _ in $(seq 1 60); do
  curl -ksf https://localhost/api/session >/dev/null 2>&1 && break
  sleep 3
done
echo "session endpoint: $(curl -ks https://localhost/api/session)"
bad=$(curl -ks -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"accessKey":"wrong-key-xxxxxxxx"}' https://localhost/api/session)
[ "$bad" = 401 ] || { echo "expected 401 for wrong key, got $bad"; exit 1; }
for _ in $(seq 1 30); do
  code=$(curl -ks -c /tmp/cj -o /tmp/login.json -w '%{http_code}' -H 'Content-Type: application/json' -d '{"accessKey":"ci-access-key-123456"}' https://localhost/api/session)
  [ "$code" = 200 ] && break
  sleep 3
done
[ "$code" = 200 ] || { echo "sign-in failed: $code $(cat /tmp/login.json)"; exit 1; }
state=$(curl -ks -b /tmp/cj https://localhost/api/vm/link/state)
echo "beeper state via the whole stack: $state"
echo "$state" | grep -q 'needs-login' || { echo "unexpected Beeper state"; exit 1; }
unauth=$(curl -ks -o /dev/null -w '%{http_code}' https://localhost/api/vm/status)
[ "$unauth" = 401 ] || { echo "unauthenticated proxy call should be 401, got $unauth"; exit 1; }
echo "SMOKE TEST OK"
