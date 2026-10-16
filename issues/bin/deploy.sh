#!/bin/sh
# Usage: issues/bin/deploy.sh
# Deploys main to kiko's Cloudflare account from a clean worktree, so the owner's uncommitted files
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
# People sign in at the hosted front door with Clerk. This Worker's own pages send the browser there; its /api stays.
door="${FRONT_DOOR:-https://kiko-app.keyurbodar16.workers.dev}"
printf '<!doctype html><meta charset="utf-8"><title>Kiko</title><meta http-equiv="refresh" content="0;url=%s/"><script>location.replace("%s"+location.pathname+location.search)</script>\n' "$door" "$door" > apps/web-solid/dist/index.html
cd apps/server
bun run deploy 2>&1 | grep -E "Uploaded kiko|Total Upload|Startup Time|Version ID|https://"
cd "$root" && git worktree remove --force "$dir"
