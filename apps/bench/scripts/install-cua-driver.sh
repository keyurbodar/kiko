#!/usr/bin/env bash
set -euo pipefail

version="0.38.0"
root="${KIKO_BENCH_TOOLS_DIR:-$HOME/.kiko-bench/tools}"
dest="$root/cua-driver-$version"
asset=""
sha=""

case "$(uname -s):$(uname -m)" in
  Linux:x86_64)
    asset="cua-driver-rs-$version-linux-x86_64-binary.tar.gz"
    sha="31ab9709dd91ce73677e49b9f3e75c6f0d3e4d9625c286c9e58262bfbea698dd"
    ;;
  Linux:aarch64 | Linux:arm64)
    asset="cua-driver-rs-$version-linux-arm64-binary.tar.gz"
    sha="80c9ae66bc7322052dd426c6133c96086b33894bf06c972bca8215384400b33d"
    ;;
  Darwin:*)
    asset="cua-driver-rs-$version-darwin-universal-binary.tar.gz"
    sha="2bb8dc4a7e69185ffd04c4a9c0eab590bd2c54b72c2c1be13ab675be4f487732"
    ;;
  *)
    echo "install-cua-driver: unsupported host $(uname -s) $(uname -m)" >&2
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

url="https://github.com/trycua/cua/releases/download/cua-driver-rs-v$version/$asset"
curl --fail --location --silent --show-error --output "$tmp/$asset" "$url"

actual="$(hash_of "$tmp/$asset")"
if [ "$actual" != "$sha" ]; then
  echo "install-cua-driver: sha256 mismatch for $asset: expected $sha, got $actual" >&2
  exit 1
fi

tar -xzf "$tmp/$asset" -C "$dest"
chmod +x "$dest/cua-driver"
"$dest/cua-driver" --version >&2
printf '%s\n' "$dest/cua-driver"
