#!/usr/bin/env bash
# Run one `yuki verify` suite per isolated wrangler dev server, concurrently.
#
#   verify-parallel.sh <suite> [suite...]   run the suites
#   verify-parallel.sh --cleanup            stop servers recorded by earlier runs
#
# Suite i gets HTTP port 8811+i and inspector port 9311+i. Wrangler state and
# the CLI session file live in a temp dir that is removed after the suite.
# Evidence (verify.log, wrangler.log, health.log, migrate.log) stays in
# .verify-evidence/<run>/<suite>/. The script signals only PIDs it recorded
# there (wrangler.pid) and their child processes.
set -o pipefail

descendants() {
  local p
  for p in $(pgrep -P "$1" 2>/dev/null); do
    echo "$p"
    descendants "$p"
  done
}

# PIDs listening on a TCP port, one per line. lsof when present, else ss.
listeners() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti ":$port" 2>/dev/null
  else
    ss -ltnp "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
  fi
}

stop_tree() {
  local pid="$1" kids
  [ -n "$pid" ] || return 0
  kids="$(descendants "$pid")"
  kill $kids "$pid" 2>/dev/null
  sleep 1
  kill -9 $kids "$pid" 2>/dev/null
  return 0
}

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not inside a git checkout" >&2; exit 1; }
EVIDENCE_ROOT="$ROOT/.verify-evidence"
SERVER="$ROOT/apps/server"

if [ "${1:-}" = "--cleanup" ]; then
  for rec in "$EVIDENCE_ROOT"/*/*/wrangler.pid; do
    [ -f "$rec" ] || continue
    pid="$(cat "$rec")"
    if kill -0 "$pid" 2>/dev/null; then
      stop_tree "$pid"
      echo "stopped recorded server pid $pid ($rec)"
    fi
  done
  exit 0
fi

[ "$#" -ge 1 ] || { echo "usage: $0 <suite> [suite...] | --cleanup" >&2; exit 2; }

RUN_ID="$(date +%Y%m%d-%H%M%S)-$$"
EVID="$EVIDENCE_ROOT/$RUN_ID"
LIMIT="${VERIFY_SUITE_LIMIT:-540}"
HEALTH_WAIT="${VERIFY_HEALTH_WAIT:-90}"
mkdir -p "$EVID"

run_one() {
  local i="$1" suite="$2"
  local port=$((8811 + i)) insp=$((9311 + i))
  local dir="$EVID/$suite" url="http://localhost:$port"
  local tmp wpid="" vpid="" watcher="" rc=1 waited=0
  mkdir -p "$dir"
  tmp="$(mktemp -d)"
  export YUKI_SESSION_FILE="$tmp/session.json"
  # Miniflare leaves a directory in the temp dir on every start. Keep it inside $tmp so cleanup removes it.
  mkdir -p "$tmp/os"
  export TMPDIR="$tmp/os"

  if [ -n "$(listeners "$port")" ]; then
    echo "[$suite] port $port already in use; not touching it"
    rm -rf "$tmp"
    return 1
  fi

  (cd "$SERVER" && NODE_ENV=development bunx wrangler d1 migrations apply kiko-auth --local --persist-to "$tmp/state" >"$dir/migrate.log" 2>&1) \
    || { echo "[$suite] migrations failed; see $dir/migrate.log"; rm -rf "$tmp"; return 1; }

  (cd "$SERVER" && exec env NODE_ENV=development bunx wrangler dev --port "$port" --inspector-port "$insp" --persist-to "$tmp/state" >"$dir/wrangler.log" 2>&1) &
  wpid=$!
  echo "$wpid" >"$dir/wrangler.pid"

  until (cd "$ROOT" && bun yuki health --url "$url" >"$dir/health.log" 2>&1); do
    sleep 2
    waited=$((waited + 2))
    if [ "$waited" -ge "$HEALTH_WAIT" ] || ! kill -0 "$wpid" 2>/dev/null; then
      echo "[$suite] server on $port never became healthy; see $dir/wrangler.log"
      stop_tree "$wpid"
      rm -rf "$tmp"
      return 1
    fi
  done

  (cd "$ROOT" && exec bun yuki verify "$suite" --url "$url" >"$dir/verify.log" 2>&1) &
  vpid=$!
  (sleep "$LIMIT"; kill "$vpid" 2>/dev/null) &
  watcher=$!
  wait "$vpid"
  rc=$?
  stop_tree "$watcher"
  stop_tree "$wpid"
  rm -rf "$tmp"

  if [ "$rc" -eq 0 ]; then
    echo "[$suite] pass (evidence: $dir)"
  else
    echo "[$suite] FAIL rc=$rc (evidence: $dir)"
  fi
  return "$rc"
}

# A suite that needs a person, or spends a shared key, must run alone.
if [ "$#" -gt 1 ]; then
  for suite in "$@"; do
    if grep -q "human: true" "$ROOT/apps/cli/src/verify/suites/$suite.ts" 2>/dev/null; then
      echo "verify-parallel: $suite is human: true; run it alone" >&2
      exit 2
    fi
  done
fi

pids=""
i=0
for suite in "$@"; do
  run_one "$i" "$suite" &
  pids="$pids $!"
  i=$((i + 1))
done

status=0
for p in $pids; do
  wait "$p" || status=1
done
echo "evidence: $EVID"
exit "$status"
