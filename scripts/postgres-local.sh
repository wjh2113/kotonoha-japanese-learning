#!/usr/bin/env bash
# Local isolated PostgreSQL for macOS / Linux (port 5433).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER="${ROOT}/.postgres-data"
LOG_FILE="${CLUSTER}/postgres.log"
ACTION="${1:-start}"
PORT="${POSTGRES_PORT:-5433}"

find_pg_bin() {
  if [[ -n "${POSTGRES_BIN:-}" && -x "${POSTGRES_BIN}/pg_ctl" ]]; then
    printf '%s\n' "${POSTGRES_BIN}"
    return
  fi
  local candidate
  for candidate in \
    /opt/homebrew/opt/postgresql@18/bin \
    /usr/local/opt/postgresql@18/bin \
    /usr/lib/postgresql/18/bin \
    /usr/pgsql-18/bin
  do
    if [[ -x "${candidate}/pg_ctl" ]]; then
      printf '%s\n' "${candidate}"
      return
    fi
  done
  if command -v pg_ctl >/dev/null 2>&1; then
    dirname "$(command -v pg_ctl)"
    return
  fi
  echo "PostgreSQL 18 binaries were not found. Install postgresql@18, set POSTGRES_BIN, or use Docker Compose." >&2
  exit 1
}

PG_BIN="$(find_pg_bin)"
PG_CTL="${PG_BIN}/pg_ctl"
PSQL="${PG_BIN}/psql"
INITDB="${PG_BIN}/initdb"
CREATEDB="${PG_BIN}/createdb"

is_running() {
  "${PG_CTL}" status -D "${CLUSTER}" >/dev/null 2>&1
}

start_local() {
  if is_running; then
    echo "KOTONOHA PostgreSQL is already running on port ${PORT}."
    return
  fi
  "${PG_CTL}" start -D "${CLUSTER}" -l "${LOG_FILE}" -o "-p ${PORT} -h 127.0.0.1" -w
}

case "${ACTION}" in
  init)
    if [[ ! -f "${CLUSTER}/PG_VERSION" ]]; then
      mkdir -p "${CLUSTER}"
      "${INITDB}" -D "${CLUSTER}" -U postgres -A trust --encoding=UTF8 --locale=C
    fi
    start_local
    if [[ "$("${PSQL}" -w -h 127.0.0.1 -p "${PORT}" -U postgres -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='kotonoha_app'")" != "1" ]]; then
      "${PSQL}" -w -h 127.0.0.1 -p "${PORT}" -U postgres -d postgres -v ON_ERROR_STOP=1 \
        -c "CREATE ROLE kotonoha_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;"
    fi
    if [[ "$("${PSQL}" -w -h 127.0.0.1 -p "${PORT}" -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='kotonoha'")" != "1" ]]; then
      "${CREATEDB}" -w -h 127.0.0.1 -p "${PORT}" -U postgres -O kotonoha_app kotonoha
    fi
    echo "KOTONOHA PostgreSQL is initialized on 127.0.0.1:${PORT}."
    echo "DATABASE_URL=postgresql://kotonoha_app@127.0.0.1:${PORT}/kotonoha"
    ;;
  start)
    start_local
    ;;
  status)
    if is_running; then
      echo "running"
      exit 0
    fi
    echo "stopped"
    exit 1
    ;;
  stop)
    if is_running; then
      "${PG_CTL}" stop -D "${CLUSTER}" -m fast -w
    fi
    echo "KOTONOHA PostgreSQL is stopped."
    ;;
  *)
    echo "Usage: $0 {init|start|status|stop}" >&2
    exit 1
    ;;
esac
