#!/bin/sh
# Usage: issues/bin/deploy-front-door.sh
# Builds the hosted client from main in a clean worktree, adds the signed release that installs and one-click
# updates read, and deploys both to the kiko-app Worker on app.kiko.works (apps/server/wrangler.front-door.jsonc).
# Reads the kiko.works account token from ~/.config/kiko/cf-kiko-works.env and the Clerk publishable key from
# ~/.config/kiko/clerk-prod.env. Prints no secret.
set -eu
root="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel)"
dir="$root/.claude/worktrees/_front"
[ -d "$dir" ] || git -C "$root" worktree add -q --detach "$dir" main
cd "$dir"
git checkout -q --detach main && git reset -q --hard main
bun install --frozen-lockfile >/dev/null 2>&1
. "$HOME/.config/kiko/cf-kiko-works.env"
export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
VITE_CLERK_PUBLISHABLE_KEY="$(sed -n 's/^CLERK_PUBLISHABLE_KEY=//p' "$HOME/.config/kiko/clerk-prod.env")"
export VITE_CLERK_PUBLISHABLE_KEY VITE_INSTALLER_URL=https://api.kiko.works
NODE_ENV=production "$root/issues/bin/heavy.sh" bun run --cwd apps/web-solid build >/dev/null
bun scripts/release.ts >/dev/null
rm -rf apps/web-solid/dist/releases && cp -r dist-release apps/web-solid/dist/releases
cd apps/server
bunx wrangler deploy --config wrangler.front-door.jsonc 2>&1 | grep -E "Uploaded|Version ID|kiko.works"
cd "$root" && git worktree remove --force "$dir"
