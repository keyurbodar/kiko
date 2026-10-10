#!/usr/bin/env bash
# Usage: server.sh start|doctor|stop
# Starts `bun dev:server` (wrangler dev, NODE_ENV=development) on localhost:8787 and waits for health.
set -u
ROOT=$(git rev-parse --show-toplevel)
OUT=${INITIATIVE_OUT:-$ROOT/artifacts/initiative}
PIDF=$OUT/server.pid
URL=${YUKI_URL:-http://localhost:8787}
mkdir -p "$OUT"
case "${1:-doctor}" in
  start)
    [ -f "$ROOT/apps/server/.dev.vars" ] || { echo "apps/server/.dev.vars is missing. copy it from the main checkout"; exit 1; }
    if curl -fs "$URL/api/health" >/dev/null 2>&1; then echo "something already answers on $URL. refusing to start a second server"; exit 1; fi
    cd "$ROOT" || exit 1
    # wrangler refuses to start without the client build (git ignores dist). Scaffolding only.
    [ -d apps/web-solid/dist ] || bun run --cwd apps/web-solid build >"$OUT/web-build.log" 2>&1 || { echo "web build failed, see $OUT/web-build.log"; exit 1; }
    NODE_ENV=development nohup bun dev:server >"$OUT/server.log" 2>&1 &
    echo $! >"$PIDF"
    for _ in $(seq 1 90); do
      curl -fs "$URL/api/health" >/dev/null 2>&1 && { echo "up: $URL (pid $(cat "$PIDF"), log $OUT/server.log)"; exit 0; }
      sleep 1
    done
    echo "no health after 90 s. tail of the log:"; tail -20 "$OUT/server.log"; exit 1 ;;
  doctor)
    echo "health: $(curl -fs "$URL/api/health" || echo DOWN)"
    echo "dev routes: HTTP $(curl -s -o /dev/null -w '%{http_code}' "$URL/api/dev/stats") (200 means NODE_ENV=development)"
    echo "listening on 8787: $(lsof -ti :8787 | tr '\n' ' ') (we started: $(cat "$PIDF" 2>/dev/null))"
    for k in OPENCODE_API_KEY TYPESAFE_API_KEY; do
      if grep -q "^$k=" "$ROOT/apps/server/.dev.vars"; then echo "$k: present in .dev.vars"; else echo "$k: MISSING"; fi
    done ;;
  stop)
    [ -f "$PIDF" ] || { echo "no pid file: nothing of ours to stop"; exit 0; }
    PID=$(cat "$PIDF")
    pkill -P "$PID" 2>/dev/null
    kill "$PID" 2>/dev/null
    # workerd outlives wrangler; kill only listeners on 8787 whose parent chain is gone from our tree
    sleep 1
    for p in $(lsof -ti :8787); do kill "$p" 2>/dev/null; done
    rm -f "$PIDF"; echo stopped ;;
esac
