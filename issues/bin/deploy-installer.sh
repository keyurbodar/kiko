#!/bin/sh
# Usage: issues/bin/deploy-installer.sh [--secrets]
# Deploys the installer Worker from main to api.kiko.works. With --secrets it also sets every secret the installer
# reads, from ~/.config/kiko (clerk-prod.env, clerk-prod-jwt.pem, release-key.json). Prints no secret.
set -eu
root="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel)"
dir="$root/.claude/worktrees/_installer"
[ -d "$dir" ] || git -C "$root" worktree add -q --detach "$dir" main
cd "$dir"
git checkout -q --detach main && git reset -q --hard main
bun install --frozen-lockfile >/dev/null 2>&1
. "$HOME/.config/kiko/cf-kiko-works.env"
export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
cd apps/installer
# A pipe into grep would hide a failed deploy, so the output is kept and wrangler's exit status decides.
out="$(bunx wrangler deploy 2>&1)" || { echo "$out" >&2; cd "$root" && git worktree remove --force "$dir"; exit 1; }
echo "$out" | grep -E "Uploaded|Version ID|kiko.works"
if [ "${1:-}" = "--secrets" ]; then
  cfg="$HOME/.config/kiko"
  put() { printf '%s' "$2" | bunx wrangler secret put "$1" >/dev/null 2>&1 && echo "secret $1 set"; }
  put CLERK_SECRET_KEY "$(sed -n 's/^CLERK_SECRET_KEY=//p' "$cfg/clerk-prod.env")"
  put CLERK_JWT_KEY "$(cat "$cfg/clerk-prod-jwt.pem")"
  put CF_OAUTH_CLIENT_ID 0167bbe4f0276693ae891ad22026958a
  put FRONT_DOOR_ORIGIN https://app.kiko.works
  put TRUSTED_ORIGINS https://app.kiko.works
  put RELEASE_BASE_URL https://app.kiko.works/releases
  put RELEASE_PUBLIC_KEY "$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["x"])' "$cfg/release-key.json")"
fi
cd "$root" && git worktree remove --force "$dir"
