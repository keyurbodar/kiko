#!/usr/bin/env bash
set -euo pipefail

target="${1:?usage: fetch-cua-driver.sh <linux-x64|linux-arm64|darwin-universal> <out-dir>}"
out="${2:?usage: fetch-cua-driver.sh <target> <out-dir>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config="$here/../cua-driver.json"

version="$(jq -r .version "$config")"
asset="$(jq -r --arg target "$target" '.assets[$target].asset // empty' "$config")"
sha="$(jq -r --arg target "$target" '.assets[$target].sha256 // empty' "$config")"
if [ -z "$asset" ] || [ -z "$sha" ]; then
  echo "fetch-cua-driver: no pinned cua-driver asset for $target" >&2
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

url="https://github.com/trycua/cua/releases/download/cua-driver-rs-v$version/$asset"
curl --fail --location --silent --show-error --output "$tmp/$asset" "$url"

actual="$(hash_of "$tmp/$asset")"
if [ "$actual" != "$sha" ]; then
  echo "fetch-cua-driver: sha256 mismatch for $asset: expected $sha, got $actual" >&2
  exit 1
fi

mkdir -p "$out"
tar -xzf "$tmp/$asset" -C "$out"
chmod +x "$out/cua-driver"
"$out/cua-driver" --version >&2
echo "$out/cua-driver"
