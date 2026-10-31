#!/usr/bin/env bash
set -euo pipefail

contender="${1:?usage: run-bench.sh <contender> <bench args...>}"
shift

case "$contender" in
  cua-driver)
    bin="$(bash apps/bench/scripts/install-cua-driver.sh | tail -n 1)"
    export KIKO_BENCH_CUA_DRIVER="$bin"
    ;;
  agent-browser)
    bin="$(bash apps/bench/scripts/install-agent-browser.sh | tail -n 1)"
    export KIKO_BENCH_AGENT_BROWSER="$bin"
    ;;
  agent-desktop)
    bin="$(bash apps/bench/scripts/install-agent-desktop.sh | tail -n 1)"
    export KIKO_BENCH_AGENT_DESKTOP="$bin"
    ;;
esac

if [ ! -d node_modules ]; then
  bun install --frozen-lockfile
fi

mkdir -p results
bash apps/bench/scripts/envs/versions.sh >"results/env-versions-${BENCH_ENV_ID:-unknown}.txt" 2>&1 || true

exec bun run bench "$@"
