#!/bin/sh
# Usage: issues/bin/land.sh <unit> <branch>
# Merges a verified unit branch into main with --no-ff, then checks main. On a conflict or a red
# check it restores main to where it was and exits non-zero, so main is never left broken.
set -u
unit="$1"
branch="$2"
root="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel)"
logs="$HOME/.cache/splus"
mkdir -p "$logs"
cd "$root"
[ -z "$(git status --short)" ] || { echo "land: main checkout is dirty"; exit 2; }
before="$(git rev-parse HEAD)"
if ! git merge --no-ff -q -m "Land $unit from $branch" "$branch" >"$logs/$unit-merge.log" 2>&1; then
  git merge --abort 2>/dev/null
  echo "land: $unit conflicts with main"; cat "$logs/$unit-merge.log"; exit 3
fi
bun install --frozen-lockfile >/dev/null 2>&1
if [ -f scripts/check.ts ]; then
  bun scripts/check.ts >"$logs/$unit-check.log" 2>&1
else
  { bun run typecheck && bun run lint && bun scripts/check-imports.ts; } >"$logs/$unit-check.log" 2>&1
fi
status=$?
if [ $status -ne 0 ]; then
  git reset -q --hard "$before"
  echo "land: $unit made main red; main restored to $before"; tail -40 "$logs/$unit-check.log"; exit 4
fi
echo "land: $unit landed as $(git rev-parse --short HEAD)"; tail -15 "$logs/$unit-check.log"
