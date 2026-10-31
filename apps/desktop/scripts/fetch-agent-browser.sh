#!/usr/bin/env bash
set -euo pipefail

target="${1:?usage: fetch-agent-browser.sh <linux-x64|linux-arm64|darwin-arm64|darwin-x64> <out-dir>}"
out="${2:?usage: fetch-agent-browser.sh <target> <out-dir>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config="$here/../agent-browser.json"

version="$(jq -r .version "$config")"
asset="$(jq -r --arg target "$target" '.assets[$target].asset // empty' "$config")"
sha="$(jq -r --arg target "$target" '.assets[$target].sha256 // empty' "$config")"
if [ -z "$asset" ] || [ -z "$sha" ]; then
  echo "fetch-agent-browser: no pinned agent-browser asset for $target" >&2
  exit 1
fi

hash_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

url="https://github.com/vercel-labs/agent-browser/releases/download/v$version/$asset"
curl --fail --location --silent --show-error --output "$tmp/$asset" "$url"

actual="$(hash_of "$tmp/$asset")"
if [ "$actual" != "$sha" ]; then
  echo "fetch-agent-browser: sha256 mismatch for $asset: expected $sha, got $actual" >&2
  exit 1
fi

mkdir -p "$out"
install -m 0755 "$tmp/$asset" "$out/agent-browser"
"$out/agent-browser" --version >&2
echo "$out/agent-browser"
