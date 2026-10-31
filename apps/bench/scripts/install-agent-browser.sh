#!/usr/bin/env bash
set -euo pipefail

version="0.41.0"
root="${KIKO_BENCH_TOOLS_DIR:-$HOME/.kiko-bench/tools}"
dest="$root/agent-browser-$version"
asset=""
sha=""

case "$(uname -s):$(uname -m)" in
  Linux:x86_64)
    asset="agent-browser-linux-x64"
    sha="399c7e9f06bd29aa933fdf25c0bd958eea06927fc0ce6f536ba6347aabd64628"
    ;;
  Linux:aarch64 | Linux:arm64)
    asset="agent-browser-linux-arm64"
    sha="e196e9cabe6cb1b01bd5912973628361b9f40a332683a12426abad007f0d3589"
    ;;
  Darwin:arm64)
    asset="agent-browser-darwin-arm64"
    sha="a402fef2489c221b17522aa21f103ca5dc47f00ff5879d4a72c39881544730ab"
    ;;
  Darwin:x86_64)
    asset="agent-browser-darwin-x64"
    sha="f108d4aa02f41eee05d6b1b05817475fd5d576d802826783ef80800da16f33e2"
    ;;
  *)
    echo "install-agent-browser: unsupported host $(uname -s) $(uname -m)" >&2
    exit 1
    ;;
esac

hash_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

mkdir -p "$dest"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

url="https://github.com/vercel-labs/agent-browser/releases/download/v$version/$asset"
curl --fail --location --silent --show-error --output "$tmp/$asset" "$url"

actual="$(hash_of "$tmp/$asset")"
if [ "$actual" != "$sha" ]; then
  echo "install-agent-browser: sha256 mismatch for $asset: expected $sha, got $actual" >&2
  exit 1
fi

install -m 0755 "$tmp/$asset" "$dest/agent-browser"
"$dest/agent-browser" --version >&2
printf '%s\n' "$dest/agent-browser"
