#!/bin/sh
# Usage: issues/bin/deploy-front-door.sh
# Builds the hosted client from main in a clean worktree, adds the signed release that one-click update reads,
# and deploys both to the kiko-app Worker (apps/server/wrangler.front-door.jsonc). Uses the wrangler login,
# not the yuki token, because kiko-app lives in the owner's own account. Prints no secret.
set -eu
FRONT_DOOR="${FRONT_DOOR:-https://kiko-app.keyurbodar16.workers.dev}"
root="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel)"
dir="$root/.claude/worktrees/_front"
[ -d "$dir" ] || git -C "$root" worktree add -q --detach "$dir" main
cd "$dir"
git checkout -q --detach main && git reset -q --hard main
bun install --frozen-lockfile >/dev/null 2>&1
# Public values: the Clerk publishable key and the installer's address.
export VITE_CLERK_PUBLISHABLE_KEY=pk_test_c21hcnQtcm9vc3Rlci0yOTY5LmNsZXJrLmFjY291bnRzLmRldiQ
export VITE_INSTALLER_URL=https://kiko-installer.keyurbodar16.workers.dev
NODE_ENV=production "$root/issues/bin/heavy.sh" bun run --cwd apps/web-solid build >/dev/null
bun scripts/release.ts >/dev/null
rm -rf apps/web-solid/dist/releases && cp -r dist-release apps/web-solid/dist/releases
cd apps/server
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID bunx wrangler deploy --config wrangler.front-door.jsonc 2>&1 | grep -E "Uploaded|Version ID|https://"
cd "$root" && git worktree remove --force "$dir"
echo "front door: $FRONT_DOOR"
