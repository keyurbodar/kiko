#!/usr/bin/env bash
# Usage: server.sh start|doctor|stop
# Starts the server's dev script (wrangler dev, NODE_ENV=development) on the port in $KIKO_URL (default localhost:8787) and waits for health.
# Not `bun dev:server`: the root script pins --port 8787, which collides with other sessions.
set -u
ROOT=$(git rev-parse --show-toplevel)
OUT=${INITIATIVE_OUT:-$ROOT/artifacts/initiative}
PIDF=$OUT/server.pid
URL=${KIKO_URL:-http://localhost:8787}
PORT=$(printf '%s' "$URL" | sed -nE 's#^[a-zA-Z]+://[^/]*:([0-9]+).*#\1#p')
PORT=${PORT:-80}
mkdir -p "$OUT"

# PIDs listening on a TCP port, one per line. lsof when present, else ss.
listeners() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti ":$port" 2>/dev/null
  else
    ss -ltnp "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
  fi
}

# Every PID in a process tree, deepest last.
descendants() {
  local p
  for p in $(pgrep -P "$1" 2>/dev/null); do
    echo "$p"
    descendants "$p"
  done
}

# Stop one tree: the recorded pid and its children. Never anything else on the port.
stop_tree() {
  local pid="$1" kids
  kids="$(descendants "$pid")"
  kill $kids "$pid" 2>/dev/null
  sleep 1
  kill -9 $kids "$pid" 2>/dev/null
}

case "${1:-doctor}" in
  start)
    [ -f "$ROOT/apps/server/.dev.vars" ] || { echo "apps/server/.dev.vars is missing. copy it from the main checkout"; exit 1; }
    if curl -fs "$URL/api/health" >/dev/null 2>&1; then echo "something already answers on $URL. refusing to start a second server"; exit 1; fi
    cd "$ROOT" || exit 1
    # wrangler refuses to start without the client build (git ignores dist). Scaffolding only.
    [ -d apps/web-solid/dist ] || bun run --cwd apps/web-solid build >"$OUT/web-build.log" 2>&1 || { echo "web build failed, see $OUT/web-build.log"; exit 1; }
    NODE_ENV=development nohup bun run --cwd apps/server dev --port "$PORT" >"$OUT/server.log" 2>&1 &
    echo $! >"$PIDF"
    for _ in $(seq 1 90); do
      curl -fs "$URL/api/health" >/dev/null 2>&1 && { echo "up: $URL (pid $(cat "$PIDF"), log $OUT/server.log)"; exit 0; }
      sleep 1
    done
    echo "no health after 90 s. tail of the log:"; tail -20 "$OUT/server.log"; exit 1 ;;
  doctor)
    echo "health: $(curl -fs "$URL/api/health" || echo DOWN)"
    echo "dev routes: HTTP $(curl -s -o /dev/null -w '%{http_code}' "$URL/api/dev/stats") (200 means NODE_ENV=development)"
    echo "listening on $PORT: $(listeners "$PORT" | tr '\n' ' ') (we started: $(cat "$PIDF" 2>/dev/null))"
    for k in OPENCODE_API_KEY TYPESAFE_API_KEY; do
      if grep -q "^$k=" "$ROOT/apps/server/.dev.vars"; then echo "$k: present in .dev.vars"; else echo "$k: MISSING"; fi
    done ;;
  stop)
    [ -f "$PIDF" ] || { echo "no pid file: nothing of ours to stop"; exit 0; }
    PID=$(cat "$PIDF")
    stop_tree "$PID"
    rm -f "$PIDF"; echo "stopped pid $PID and its children" ;;
esac
