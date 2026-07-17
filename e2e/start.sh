#!/usr/bin/env bash
# Bring up the full local E2E environment:
#   1. Postgres 16 with the production-replicated schema (db-setup.sh)
#   2. supashim (Supabase wire-protocol shim + groq mock + fetch forwarder)
#   3. next dev with env pointed at the shim
# Writes PIDs/logs under e2e/.data. Idempotent-ish: kills previous
# shim/next instances first.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/.." && pwd)"
DATA="$DIR/.data"
mkdir -p "$DATA"

"$DIR/db-setup.sh"

pkill -f 'e2e/supashim.mjs' 2>/dev/null || true
# next dev spawns a detached next-server worker that outlives its parent;
# kill both or the new instance silently binds :3001 instead of :3000.
pkill -f 'next dev' 2>/dev/null || true
pkill -f 'next-server' 2>/dev/null || true
for _ in $(seq 1 10); do
  ss -tln 2>/dev/null | grep -q ':3000 ' || break
  sleep 1
done

node "$DIR/supashim.mjs" > "$DATA/shim.log" 2>&1 &
echo $! > "$DATA/shim.pid"

for _ in $(seq 1 20); do
  curl -sf --noproxy '*' http://127.0.0.1:54321/health >/dev/null && break
  sleep 0.5
done

ANON_KEY=$(grep -m1 '^ANON_KEY=' "$DATA/shim.log" | cut -d= -f2-)
if [ -z "$ANON_KEY" ]; then
  echo "shim failed to start:" >&2
  cat "$DATA/shim.log" >&2
  exit 1
fi

cd "$REPO"
env \
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
  GROQ_API_KEY=e2e-local-dummy \
  NODE_OPTIONS="--import $DIR/preload-fetch.mjs" \
  npm run dev > "$DATA/next.log" 2>&1 &
echo $! > "$DATA/next.pid"

for _ in $(seq 1 60); do
  curl -sf --noproxy '*' http://localhost:3000/login >/dev/null && break
  sleep 1
done

echo "e2e environment up: app http://localhost:3000, shim http://127.0.0.1:54321"
