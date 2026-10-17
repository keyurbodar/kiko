#!/usr/bin/env bash
# Stop only the processes one run recorded in /tmp/kiko-verify/<run-id>/, and its agent-browser session.
# Usage: .cursor/skills/verify-kiko/bin/down.sh <run-id>
# Evidence and logs stay in the run dir. Never pkill or killall: other sessions run servers too.
set -uo pipefail

RUN_ID="${1:?usage: down.sh <run-id>}"
RUN_DIR="/tmp/kiko-verify/$RUN_ID"
[ -d "$RUN_DIR" ] || { echo "down.sh: no run dir at $RUN_DIR" >&2; exit 1; }
# shellcheck disable=SC1091
. "$RUN_DIR/env"

# Every descendant of a PID, deepest first, so workerd and the esbuild helpers go with wrangler.
descendants() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    descendants "$child"
    echo "$child"
  done
}

stop_tree() {
  local pid="$1" kids
  [ -n "$pid" ] || return 0
  kids="$(descendants "$pid")"
  for p in $kids "$pid"; do
    kill -TERM "$p" 2>/dev/null || true
  done
}

for file in "$RUN_DIR/server.launcher.pid" "$RUN_DIR/client.launcher.pid"; do
  [ -s "$file" ] && stop_tree "$(cat "$file")"
done
if [ -s "$RUN_DIR/listeners.pid" ]; then
  while read -r _name pid; do stop_tree "$pid"; done < "$RUN_DIR/listeners.pid"
fi

sleep 2
for p in $(awk '{print $2}' "$RUN_DIR/listeners.pid" 2>/dev/null) $(cat "$RUN_DIR"/*.launcher.pid 2>/dev/null); do
  if kill -0 "$p" 2>/dev/null; then kill -KILL "$p" 2>/dev/null || true; fi
done

agent-browser --session "$SESSION" close >/dev/null 2>&1 || true
echo "stopped run $RUN_ID (recorded pids only). Evidence kept in $RUN_DIR/evidence"
