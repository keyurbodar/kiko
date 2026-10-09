#!/usr/bin/env bash
set -euo pipefail

port="${YUKI_PORT:-3017}"
label="${1:?usage: shots.sh <label> [state...]}"
shift
out="/tmp/kiko-verify-evidence/shots/${label}"
states="[]"
if [ "$#" -gt 0 ]; then
  states="[$(printf '"%s",' "$@" | sed 's/,$//')]"
fi

{
  printf 'const PORT = %s;\nconst OUT = "%s";\nconst LABEL = "%s";\nconst STATES = %s;\n' \
    "$port" "$out" "$label" "$states"
  cat "$(dirname "$0")/shots.js"
} | ego-browser nodejs 2>&1
