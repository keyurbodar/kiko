#!/bin/sh
# Usage: issues/bin/deploy.sh
# Deploys main to yuki's Cloudflare account from a clean worktree, so the owner's uncommitted files
# never ship. Reads the account token from ~/.config/yuki/cloudflare.env and prints no secret.
set -eu
root="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel)"
dir="$root/.claude/worktrees/_deploy"
[ -d "$dir" ] || git -C "$root" worktree add -q --detach "$dir" main
cd "$dir"
git checkout -q --detach main && git reset -q --hard main
bun install --frozen-lockfile >/dev/null 2>&1
set -a; . "$HOME/.config/yuki/cloudflare.env"; set +a
"$root/issues/bin/heavy.sh" bun run --cwd apps/web-solid build >/dev/null
cd apps/server
bunx wrangler d1 migrations apply kiko-auth --remote 2>&1 | grep -E "No migrations|✅" | tail -1
bun run deploy 2>&1 | grep -E "Uploaded kiko|Total Upload|Startup Time|Version ID|https://"
cd "$root" && git worktree remove --force "$dir"
