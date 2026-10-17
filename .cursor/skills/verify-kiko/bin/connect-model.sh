#!/usr/bin/env bash
# Connect a provider's API key to the verify owner through the credentials route. Prints status codes only, never the key.
# Usage: .cursor/skills/verify-kiko/bin/connect-model.sh <run-id> [provider] [env-var]
# Defaults: provider opencode-go, key from OPENCODE_API_KEY. The key is read from the shell or apps/server/.dev.vars.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
RUN_ID="${1:?usage: connect-model.sh <run-id> [provider] [env-var]}"
PROVIDER="${2:-opencode-go}"
VAR="${3:-OPENCODE_API_KEY}"
RUN_DIR="/tmp/kiko-verify/$RUN_ID"
# shellcheck disable=SC1091
. "$RUN_DIR/env"

if [ -z "${!VAR:-}" ] && [ -r "$ROOT/apps/server/.dev.vars" ]; then
  set -a; . "$ROOT/apps/server/.dev.vars"; set +a
fi
[ -n "${!VAR:-}" ] || { echo "connect-model.sh: $VAR is not set in the shell or apps/server/.dev.vars. Ask the owner to add it there, do not paste it here." >&2; exit 1; }

TOKEN="$(cat "$RUN_DIR/token")"
BODY="$(jq -n --arg k "${!VAR}" '{apiKey: $k}')"
put=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$SERVER_URL/api/credentials/$PROVIDER" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "$BODY")
unset BODY
echo "PUT /api/credentials/$PROVIDER -> $put"
check=$(curl -sS -X POST "$SERVER_URL/api/credentials/$PROVIDER/check" -H "authorization: Bearer $TOKEN")
echo "POST /api/credentials/$PROVIDER/check -> $(echo "$check" | jq -c '.provider | {provider, chat, judge}' 2>/dev/null || echo "check did not parse")"
[ "$put" = "200" ] || [ "$put" = "201" ] || [ "$put" = "204" ] || exit 1
