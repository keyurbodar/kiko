#!/bin/sh
# Usage: issues/bin/deploy-front-door.sh
# Builds the hosted client from main in a clean worktree, adds the signed release that installs and one-click
# updates read (and every earlier release, kept in ~/.local/share/kiko/releases), and deploys both to the kiko-app Worker on app.kiko.works (apps/server/wrangler.front-door.jsonc).
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
# A released version is never replaced with other code: a backend on it would think it is current and never update.
version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' dist-release/latest.json)"
live="$(curl -sf "https://app.kiko.works/releases/$version/manifest.json" || true)"
# An unknown path answers with the app page, so only a body that names the version counts as released.
case "$live" in *"\"version\": \"$version\""*) ;; *) live="" ;; esac
if [ -n "$live" ] && [ "$live" != "$(cat "dist-release/$version/manifest.json")" ]; then
  echo "Version $version is already released with other code. Bump the version in package.json." >&2
  cd "$root" && git worktree remove --force "$dir"
  exit 1
fi
# Every release stays served: a tab on an older app updates its backend to that app's version.
store="$HOME/.local/share/kiko/releases"
mkdir -p "$store"
bun "$root/issues/bin/keep-release.ts" "$store" https://app.kiko.works/releases
rm -rf "${store:?}/$version" && cp -r "dist-release/$version" "$store/$version"
rm -rf apps/web-solid/dist/releases && cp -r "$store" apps/web-solid/dist/releases && cp dist-release/latest.json apps/web-solid/dist/releases/
cd apps/server
# A pipe into grep would hide a failed deploy, so the output is kept and wrangler's exit status decides.
out="$(bunx wrangler deploy --config wrangler.front-door.jsonc 2>&1)" || { echo "$out" >&2; cd "$root" && git worktree remove --force "$dir"; exit 1; }
echo "$out" | grep -E "Uploaded|Version ID|kiko.works"
cd "$root" && git worktree remove --force "$dir"
