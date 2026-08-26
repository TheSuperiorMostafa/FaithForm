#!/usr/bin/env bash
#
# Applies the whole migration chain to a **fresh disposable** database, then
# runs the real database suite against it.
#
# Why a fresh one every time: migration 0055 uses `create policy`, which has no
# `if not exists` form, so a second application against the same database fails.
# That is a property of the chain, not a bug to work around — and rehearsing on
# a reused database would hide it until staging.
#
# Refuses anything that looks like a real deployment. This creates and drops
# databases; pointing it at production would be catastrophic and is exactly the
# kind of mistake a tired person makes at 11pm.

set -euo pipefail

cd "$(dirname "$0")/.."

HOST="${FAITHFUL_PG_HOST:-localhost}"
PORT="${FAITHFUL_PG_PORT:-5432}"
USER="${FAITHFUL_PG_USER:-postgres}"
DB="${FAITHFUL_REHEARSAL_DB:-faithful_rehearsal_$$}"

if echo "$HOST" | grep -qiE "prod|supabase\.co|amazonaws|rds"; then
  echo "Refusing to rehearse against a host that looks like a real deployment: $HOST" >&2
  exit 1
fi

psql_() { psql -h "$HOST" -p "$PORT" -U "$USER" "$@"; }

echo "Rehearsing the full chain on a fresh database: $DB"
psql_ -q -c "drop database if exists $DB;" >/dev/null
psql_ -q -c "create database $DB;" >/dev/null

cleanup() {
  psql_ -q -c "drop database if exists $DB;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "  bootstrap"
psql_ -d "$DB" -q -v ON_ERROR_STOP=1 -f tests/database/fixtures/bootstrap.sql

# Every migration, in order, every time. Not a subset: the point of a rehearsal
# is that the chain applies, and a chain that is only ever applied in pieces is
# a chain nobody has applied.
for file in supabase/migrations/*.sql; do
  name=$(basename "$file")
  case "$name" in
    00[0-4]*|005[0-4]*) continue ;;  # pre-Faithful; the bootstrap stands in
  esac
  echo "  $name"
  psql_ -d "$DB" -q -v ON_ERROR_STOP=1 -f "$file"
done

echo ""
echo "Chain applied. Every Faithful migration on disk, in order."
echo ""

# The concurrency runner applies its own curated list. A migration added to the
# repository and forgotten there would never be exercised by it — and would
# reach staging unrehearsed. This is the check that catches that.
MISSING=0
for file in supabase/migrations/*.sql; do
  name=$(basename "$file")
  case "$name" in
    00[0-4]*|005[0-4]*) continue ;;
  esac
  if ! grep -q "$name" scripts/run-attendance-concurrency.mjs; then
    echo "  UNREGISTERED $name is not in the database test runner's list" >&2
    MISSING=$((MISSING + 1))
  fi
done
if [ "$MISSING" -gt 0 ]; then
  echo "" >&2
  echo "$MISSING migration(s) are applied by this rehearsal and by nothing else." >&2
  exit 1
fi

echo "Running the database suite against the rehearsed database."
# A Unix-socket directory cannot go in a URL's host position — it has to be a
# `host=` parameter. Getting this wrong produces an authentication error that
# reads as a credentials problem, which is a long way from the truth.
case "$HOST" in
  /*) export FAITHFUL_TEST_DATABASE_URL="postgresql://${USER}@localhost:${PORT}/${DB}?host=${HOST}" ;;
  *)  export FAITHFUL_TEST_DATABASE_URL="postgresql://${USER}@${HOST}:${PORT}/${DB}" ;;
esac
# The test *files*, not the runner: the runner would apply the chain a second
# time, and migration 0055's `create policy` has no `if not exists` form.
node --import tsx --test tests/database/*.test.ts

echo ""
echo "Rehearsal complete. The database was dropped."
