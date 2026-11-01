#!/usr/bin/env bash
set -euo pipefail

mode="${1:?usage: nixos-image.sh <build|restore> <dir>}"
dir="${2:?usage: nixos-image.sh <build|restore> <dir>}"
here="$(cd "$(dirname "$0")/../../envs/nixos-25.05" && pwd)"

case "$mode" in
  build)
    mkdir -p "$dir"
    nix build --no-write-lock-file "$here#nixosConfigurations.bench.config.system.build.vm" -o "$dir/result"
    nix-store --export $(nix-store -qR "$dir/result") >"$dir/closure.nar"
    readlink -f "$dir"/result/bin/run-*-vm >"$dir/run-script"
    ;;
  restore)
    if [ ! -f "$dir/closure.nar" ] || [ ! -f "$dir/run-script" ]; then
      echo "nixos-image: $dir holds no closure, so it cannot restore" >&2
      exit 1
    fi
    nix-store --import <"$dir/closure.nar" >/dev/null
    cat "$dir/run-script"
    ;;
  *)
    echo "nixos-image: unknown mode $mode" >&2
    exit 2
    ;;
esac
