#!/bin/sh
# Usage: issues/bin/land.sh <unit> <branch>
# Proves the merge in a separate integration worktree first, then merges into main. The main
# checkout may hold someone else's uncommitted work, so this script never resets or cleans it.
set -u
unit="$1"
branch="$2"
root="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel)"
lane="$root/.claude/worktrees/_land"
logs="$HOME/.cache/splus"
mkdir -p "$logs"
[ -d "$lane" ] || git -C "$root" worktree add -q --detach "$lane" main
cd "$lane"
git checkout -q --detach main && git reset -q --hard main
if ! git merge --no-ff -q -m "Land $unit from $branch" "$branch" >"$logs/$unit-merge.log" 2>&1; then
  git merge --abort 2>/dev/null
  echo "land: $unit conflicts with main"; cat "$logs/$unit-merge.log"; exit 3
fi
bun install --frozen-lockfile >/dev/null 2>&1
[ -e apps/server/.dev.vars ] || ln -s "$HOME/.config/yuki/dev.vars" apps/server/.dev.vars 2>/dev/null
if [ -f scripts/check.ts ]; then
  "$root/issues/bin/heavy.sh" bun scripts/check.ts >"$logs/$unit-check.log" 2>&1
else
  { bun run typecheck && bunx biome check apps/server core apps/cli scripts && bun scripts/check-imports.ts && { [ ! -f scripts/check-rules.ts ] || bun scripts/check-rules.ts; } && { [ ! -f scripts/check-exports.ts ] || bun scripts/check-exports.ts; }; } >"$logs/$unit-check.log" 2>&1
fi
if [ $? -ne 0 ]; then
  "$root/issues/bin/ledger.sh" "$unit" state=gate-red evidence="$logs/$unit-check.log"
  echo "land: $unit is red when merged; main untouched"; tail -40 "$logs/$unit-check.log"; exit 4
fi
cd "$root"
if ! git merge --no-ff -q -m "Land $unit from $branch" "$branch" >>"$logs/$unit-merge.log" 2>&1; then
  git merge --abort 2>/dev/null
  echo "land: $unit merged green in the lane but not in main; see $logs/$unit-merge.log"; exit 5
fi
sha="$(git rev-parse --short HEAD)"
"$root/issues/bin/ledger.sh" "$unit" state=landed verdict=gate-green head="$(git rev-parse --short "$branch")" evidence="main_$sha"
# A landed unit's brief and report are done; git history keeps them. Only paths git tracks are removed.
done_files="$(git ls-files "issues/$unit.md" "issues/$unit-*.md")"
if [ -n "$done_files" ]; then
  git rm -q $done_files && git commit -q -m "Close $unit: remove its brief and report" -- issues/
fi
echo "land: $unit landed as $sha"; tail -8 "$logs/$unit-check.log"
