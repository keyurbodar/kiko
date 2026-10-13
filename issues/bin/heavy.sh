#!/bin/sh
# Usage: issues/bin/heavy.sh <command...>
# Runs a heavy command (a gate, a test run, a typecheck, a dev server suite) only when one of
# HEAVY_SLOTS (default 8) machine-wide slots is free. Every unit and the landing lane share the same slots, so
# at most that many builds run at once. A slot is held at most HEAVY_MAX_S
# seconds (default two hours), so a forgotten sleep or server cannot hold it for good.
# /tmp is a small tmpfs. A full one breaks every build with ENOSPC, so refuse early and say why.
free_kb=$(df -Pk /tmp | awk 'NR==2 {print $4}')
if [ "${free_kb:-0}" -lt 1048576 ]; then
  echo "heavy.sh: /tmp has less than 1 GB free. Find the biggest entries with: du -sh /tmp/* | sort -h | tail" >&2
  exit 75
fi
dir="${XDG_RUNTIME_DIR:-/tmp}/kiko-heavy"
mkdir -p "$dir"
while :; do
  for slot in $(seq 1 "${HEAVY_SLOTS:-8}"); do
    exec 9>"$dir/slot-$slot"
    if flock -n 9; then
      timeout -k 10 "${HEAVY_MAX_S:-7200}" "$@"
      exit $?
    fi
  done
  sleep 5
done
