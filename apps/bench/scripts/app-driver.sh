#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: app-driver.sh <command...>" >&2
  exit 2
fi

if [ -z "${KIKO_BIN:-}" ]; then
  exec "$@"
fi

app="${KIKO_APP_DIR:-$(mktemp -d)}"
mkdir -p "$app"

KIKO_APP_DIR="$app" \
  KIKO_COMPUTER_DIR="$app/computer" \
  KIKO_CORE="${KIKO_CORE:-$KIKO_BIN}" \
  KIKO_CORE_STUB_LOG="$app/starts.log" \
  "$KIKO_BIN" >"$app/app.log" 2>&1 &
app_pid=$!

stop_app() {
  kill "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
}
trap stop_app EXIT

socket="$app/driver.sock"
for _ in $(seq 1 600); do
  if [ -S "$socket" ]; then break; fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "the kiko app exited before it opened $socket" >&2
    tail -n 100 "$app/app.log" >&2 || true
    exit 1
  fi
  sleep 0.1
done
if [ ! -S "$socket" ]; then
  echo "the kiko app never opened $socket" >&2
  tail -n 100 "$app/app.log" >&2 || true
  exit 1
fi

export KIKO_DRIVER="$socket"
export KIKO_APP_DIR="$app"

status=0
"$@" || status=$?
exit "$status"
