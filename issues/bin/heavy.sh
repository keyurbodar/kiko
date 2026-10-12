#!/bin/sh
# Usage: issues/bin/heavy.sh <command...>
# Runs a heavy command (a gate, a test run, a typecheck, a dev server suite) only when one of
# two machine-wide slots is free. Every unit and the landing lane share the same two slots, so
# at most two builds run at once and the machine never stalls. A slot is held at most HEAVY_MAX_S
# seconds (default two hours), so a forgotten sleep or server cannot hold it for good.
dir="${XDG_RUNTIME_DIR:-/tmp}/yuki-heavy"
mkdir -p "$dir"
while :; do
  for slot in 1 2; do
    exec 9>"$dir/slot-$slot"
    if flock -n 9; then
      timeout -k 10 "${HEAVY_MAX_S:-7200}" "$@"
      exit $?
    fi
  done
  sleep 5
done
