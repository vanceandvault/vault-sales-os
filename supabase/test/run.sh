#!/usr/bin/env bash
# Runs migrations + SQL tests against a throw-away local PostgreSQL (stubs Supabase's auth schema).
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=$(mktemp -d); PORT=54999
trap '$PGBIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true; chmod -R u+rwX $DIR; rm -rf $DIR' EXIT
if [ "$(id -u)" = "0" ]; then
  id pgtest >/dev/null 2>&1 || useradd -m pgtest
  chown pgtest $DIR; RUN="su pgtest -c"
else RUN="bash -c"; fi
$RUN "$PGBIN/initdb -D $DIR/data -A trust >/dev/null"
$RUN "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log start -w >/dev/null"
PSQL="psql -h $DIR -p $PORT -U pgtest -v ON_ERROR_STOP=1 -q -t -A"
createdb -h $DIR -p $PORT -U pgtest t 2>/dev/null || $RUN "$PGBIN/createdb -h $DIR -p $PORT t"
PSQL="$PSQL -d t"
$PSQL -f supabase/test/00_stub_supabase.sql
for f in supabase/migrations/*.sql; do echo "• $f"; $PSQL -f "$f"; done
for f in supabase/test/[1-9]*.sql; do echo "• $f"; $PSQL -f "$f"; done
echo "DB TESTS PASSED"
