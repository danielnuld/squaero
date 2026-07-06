#!/usr/bin/env bash
# One-command smoke runner per engine (issue #199). Builds quaero-rpc, brings up
# the engine (ephemeral container for mysql/mongodb with --docker, or an existing
# server), runs the step-by-step smoke, and reports ✅/❌ per step.
#
# Usage:
#   scripts/smoke/run.sh sqlite
#   scripts/smoke/run.sh mysql   [--docker]
#   scripts/smoke/run.sh mongodb [--docker]
#
# Without --docker, mysql/mongodb use QUAERO_SMOKE_DSN (JSON) or the built-in
# default DSN pointing at a locally running server.
#
# Requirements: cmake-built tree in build/, node, and (for --docker) docker.
set -u
ENGINE="${1:-}"
DOCKER="${2:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

if [ -z "$ENGINE" ]; then
  echo "usage: run.sh <sqlite|mysql|mongodb> [--docker]"; exit 2
fi

echo "== building quaero-rpc =="
cmake --build build --target quaero-rpc >/dev/null || { echo "build failed"; exit 2; }

# Windows: the mysql/mongodb plugins need their client runtime DLL (libmysql.dll)
# on the search path; it is staged next to the app.
export PATH="$ROOT/build/app:$PATH"

CID=""
cleanup() { [ -n "$CID" ] && { echo "== stopping container =="; docker rm -f "$CID" >/dev/null 2>&1; }; }
trap cleanup EXIT

case "$ENGINE" in
  sqlite)
    node scripts/smoke/smoke.mjs sqlite build/app/drivers
    exit $?
    ;;
  mysql)
    if [ "$DOCKER" = "--docker" ]; then
      echo "== starting ephemeral mysql:8 on :13399 =="
      CID="$(docker run --rm -d -e MYSQL_ROOT_PASSWORD=test123 -e MYSQL_DATABASE=testdb \
              -p 13399:3306 mysql:8)" || { echo "docker run failed"; exit 2; }
      echo -n "waiting for mysql"
      for _ in $(seq 1 60); do
        if docker exec "$CID" mysqladmin ping -ptest123 --silent >/dev/null 2>&1; then break; fi
        echo -n "."; sleep 2
      done; echo
      export QUAERO_SMOKE_DSN='{"host":"127.0.0.1","port":"13399","user":"root","password":"test123","database":"testdb"}'
    fi
    node scripts/smoke/smoke.mjs mysql build/app/drivers
    exit $?
    ;;
  mongodb)
    if [ "$DOCKER" = "--docker" ]; then
      echo "== starting ephemeral mongo:7 on :27099 =="
      CID="$(docker run --rm -d -p 27099:27017 mongo:7)" || { echo "docker run failed"; exit 2; }
      sleep 5
      export QUAERO_SMOKE_DSN='{"host":"127.0.0.1","port":"27099","database":"test"}'
    fi
    node scripts/smoke/smoke.mjs mongodb build/app/drivers
    exit $?
    ;;
  *)
    echo "unknown engine: $ENGINE"; exit 2 ;;
esac
