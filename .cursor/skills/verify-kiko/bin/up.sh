#!/usr/bin/env bash
# Launch a Kiko server and client for one verify run, wait until both answer, sign in, and print what to use.
# Usage: .cursor/skills/verify-kiko/bin/up.sh [--run-id <id>] [--server-port <n>] [--client-port <n>] [--owner <name>]
# Everything the run starts is recorded under /tmp/kiko-verify/<run-id>/ so bin/down.sh stops only that.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
RUN_ID="$(date +%Y%m%d-%H%M%S)-$$"
SERVER_PORT=8791
CLIENT_PORT=5191
OWNER="verify-kiko"

while [ $# -gt 0 ]; do
  case "$1" in
    --run-id) RUN_ID="$2"; shift 2 ;;
    --server-port) SERVER_PORT="$2"; shift 2 ;;
    --client-port) CLIENT_PORT="$2"; shift 2 ;;
    --owner) OWNER="$2"; shift 2 ;;
    *) echo "up.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
INSPECTOR_PORT=$((SERVER_PORT + 1000))
RUN_DIR="/tmp/kiko-verify/$RUN_ID"
SERVER_URL="http://localhost:$SERVER_PORT"
CLIENT_URL="http://localhost:$CLIENT_PORT"

fail() { echo "up.sh: $*" >&2; exit 1; }

# A port that already answers belongs to someone else (another session). Refuse it.
for p in "$SERVER_PORT" "$CLIENT_PORT" "$INSPECTOR_PORT"; do
  if ss -ltnH "sport = :$p" | grep -q .; then fail "port $p is already in use. Pick another with --server-port or --client-port"; fi
done
[ -e "$ROOT/apps/server/.dev.vars" ] || fail "apps/server/.dev.vars is missing. A git hook links it to ~/.config/kiko/dev.vars"
[ -e "$RUN_DIR" ] && fail "run dir $RUN_DIR already exists. Use a new --run-id"

mkdir -p "$RUN_DIR/evidence" "$RUN_DIR/state"
chmod 700 "$RUN_DIR"
cat > "$RUN_DIR/env" <<EOT
RUN_ID=$RUN_ID
SERVER_PORT=$SERVER_PORT
CLIENT_PORT=$CLIENT_PORT
SERVER_URL=$SERVER_URL
CLIENT_URL=$CLIENT_URL
OWNER=$OWNER
SESSION=kiko-$RUN_ID
EOT

# wrangler serves the client from dist, so a fresh worktree needs one build first.
if [ ! -d "$ROOT/apps/web-solid/dist" ]; then
  (cd "$ROOT" && bun run --cwd apps/web-solid build >"$RUN_DIR/build.log" 2>&1) || fail "client build failed. See $RUN_DIR/build.log"
fi

# Start both in the background. The launcher PID is recorded; the real listeners are recorded once they bind.
cd "$ROOT"
NODE_ENV=development setsid -f bun run --cwd apps/server dev --port "$SERVER_PORT" --inspector-port "$INSPECTOR_PORT" --persist-to "$RUN_DIR/state" </dev/null >"$RUN_DIR/server.log" 2>&1
KIKO_SERVER_PORT="$SERVER_PORT" setsid -f bun run --cwd apps/web-solid dev --port "$CLIENT_PORT" --strictPort </dev/null >"$RUN_DIR/client.log" 2>&1
sleep 1
# The launchers are the newest bun processes whose command line names our ports.
pgrep -f "bun run --cwd apps/server dev --port $SERVER_PORT " | head -1 > "$RUN_DIR/server.launcher.pid" || true
pgrep -f "bun run --cwd apps/web-solid dev --port $CLIENT_PORT " | head -1 > "$RUN_DIR/client.launcher.pid" || true

listener_pid() { ss -ltnpH "sport = :$1" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true; }

# Ready = the API answers and the client page loads. Give the first Worker build up to 4 minutes.
deadline=$((SECONDS + 240))
until curl -fsS "$SERVER_URL/api/health" >/dev/null 2>&1 && curl -fsS "$CLIENT_URL/" >/dev/null 2>&1; do
  if [ $SECONDS -ge $deadline ]; then
    echo "up.sh: not ready after 240 s. Last server log lines:" >&2
    tail -n 20 "$RUN_DIR/server.log" >&2
    echo "up.sh: last client log lines:" >&2
    tail -n 10 "$RUN_DIR/client.log" >&2
    "$(dirname "$0")/down.sh" "$RUN_ID" >/dev/null 2>&1 || true
    exit 1
  fi
  sleep 2
done

{
  echo "server $(listener_pid "$SERVER_PORT")"
  echo "client $(listener_pid "$CLIENT_PORT")"
  echo "inspector $(listener_pid "$INSPECTOR_PORT")"
} > "$RUN_DIR/listeners.pid"

# Dev sign-in. Only a development build with a local host answers this route. The token goes to a 0600 file, never to stdout.
curl -fsS -X POST "$SERVER_URL/api/auth/dev/session" -H 'content-type: application/json' -d "{\"name\":\"$OWNER\"}" \
  | jq -r '.token' > "$RUN_DIR/token"
chmod 600 "$RUN_DIR/token"
[ -s "$RUN_DIR/token" ] && [ "$(cat "$RUN_DIR/token")" != "null" ] || fail "dev sign-in returned no token. See $RUN_DIR/server.log"

echo "run id:        $RUN_ID"
echo "run dir:       $RUN_DIR"
echo "server:        $SERVER_URL   (GET /api/health answers)"
echo "client:        $CLIENT_URL   (page loads)"
echo "token file:    $RUN_DIR/token   (bearer token, do not print it)"
echo "browser:       agent-browser --session kiko-$RUN_ID open \"$CLIENT_URL/#token=\$(cat $RUN_DIR/token)\""
echo "stop with:     .cursor/skills/verify-kiko/bin/down.sh $RUN_ID"
