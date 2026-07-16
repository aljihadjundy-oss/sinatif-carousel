#!/usr/bin/env bash
# Local E2E database: real Postgres 16 (system package), schema replicated
# from production. Run as root; postgres processes run as the postgres user.
set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
BASE=${E2E_PG_BASE:-/tmp/e2e-pg}
DATA="$BASE/data"
PORT=${E2E_PG_PORT:-55432}
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$BASE"
chown -R postgres:postgres "$BASE"

if [ ! -f "$DATA/PG_VERSION" ]; then
  su postgres -c "$PGBIN/initdb -D '$DATA' -U postgres --auth=trust --auth-host=trust" >/dev/null
fi

if ! su postgres -c "$PGBIN/pg_ctl -D '$DATA' status" >/dev/null 2>&1; then
  su postgres -c "$PGBIN/pg_ctl -D '$DATA' -l '$BASE/pg.log' -o '-p $PORT -k $BASE -c listen_addresses=127.0.0.1' start"
fi

for _ in $(seq 1 30); do
  if su postgres -c "$PGBIN/pg_isready -h 127.0.0.1 -p $PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done

PSQL="$PGBIN/psql -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1"

su postgres -c "$PSQL -tc \"select 1 from pg_database where datname = 'app'\"" | grep -q 1 \
  || su postgres -c "$PSQL -c 'create database app'"

su postgres -c "$PSQL -d app -f '$REPO_DIR/e2e/sql/bootstrap.sql'"
su postgres -c "$PSQL -d app -f '$REPO_DIR/e2e/sql/schema.sql'"

echo "e2e postgres ready on 127.0.0.1:$PORT (db: app)"
