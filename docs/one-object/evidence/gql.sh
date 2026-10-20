#!/bin/bash
# Runs one Cloudflare GraphQL analytics query with the wrangler login. Never prints the token.
# Usage: CF_ACCOUNT=<account id> bash gql.sh <query.json>
set -euo pipefail
CONFIG="${WRANGLER_CONFIG:-$HOME/.config/.wrangler/config/default.toml}"
TOKEN=$(grep -E '^oauth_token' "$CONFIG" | sed -E 's/.*= *"(.*)"/\1/')
sed "s/\$ACCOUNT/${CF_ACCOUNT:?set CF_ACCOUNT}/" "$1" |
  curl -s https://api.cloudflare.com/client/v4/graphql -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data @-
