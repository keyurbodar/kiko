#!/bin/sh
# Usage: issues/bin/wt.sh <unit-id> <branch> [base]
# Creates an isolated worktree for one unit, installs dependencies, and prints its path.
set -eu
unit="$1"
branch="$2"
base="${3:-main}"
root="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel)"
path="$root/.claude/worktrees/$unit"
if [ ! -d "$path" ]; then
  git -C "$root" worktree add -q -b "$branch" "$path" "$base"
fi
(cd "$path" && bun install --frozen-lockfile >/dev/null 2>&1)
echo "$path"
