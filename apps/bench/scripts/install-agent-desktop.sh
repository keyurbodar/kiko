#!/usr/bin/env bash
set -euo pipefail

version="1.0.2"
root="${KIKO_BENCH_TOOLS_DIR:-$HOME/.kiko-bench/tools}"
dest="$root/agent-desktop-$version"
asset=""
sha=""

case "$(uname -s):$(uname -m)" in
  Linux:x86_64)
    asset="agent-desktop-v$version-x86_64-unknown-linux-gnu.tar.gz"
    sha="ad661b7a3fd8f990a769243f4889a240ca0e2c8dab3ef5bddd6019086c71e0b4"
    ;;
  Linux:aarch64 | Linux:arm64)
    asset="agent-desktop-v$version-aarch64-unknown-linux-gnu.tar.gz"
    sha="864cb782e0afc8bf0df19622016b24bdbd1a83fc7749f784ee82aa49a7f845eb"
    ;;
  Darwin:arm64)
    asset="agent-desktop-v$version-aarch64-apple-darwin.tar.gz"
    sha="7bee385196d7b478de80cf05ca4304aaa38f0eba593b3406ad3c247c1773be19"
    ;;
  Darwin:x86_64)
    asset="agent-desktop-v$version-x86_64-apple-darwin.tar.gz"
    sha="8edda6df17eafc042395502a823dbb8415bc8ac14835a6731e4d8becc9cb4121"
    ;;
  *)
    echo "install-agent-desktop: unsupported host $(uname -s) $(uname -m)" >&2
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

url="https://github.com/vercel-labs/agent-desktop/releases/download/v$version/$asset"
curl --fail --location --silent --show-error --output "$tmp/$asset" "$url"

actual="$(hash_of "$tmp/$asset")"
if [ "$actual" != "$sha" ]; then
  echo "install-agent-desktop: sha256 mismatch for $asset: expected $sha, got $actual" >&2
  exit 1
fi

tar -xzf "$tmp/$asset" -C "$dest"
chmod +x "$dest/agent-desktop"
"$dest/agent-desktop" version >&2
printf '%s\n' "$dest/agent-desktop"
