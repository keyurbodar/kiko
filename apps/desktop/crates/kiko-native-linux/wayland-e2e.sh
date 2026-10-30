#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="${HOME}/.cargo/bin:${PATH}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${HOME}/.cache/kiko-desktop-target}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
if [ -z "${LIBCLANG_PATH:-}" ]; then
  for candidate in /usr/lib/llvm-*/lib; do
    if [ -e "${candidate}/libclang.so" ]; then
      export LIBCLANG_PATH="$candidate"
      break
    fi
  done
fi

runtime="$(mktemp -d)"
chmod 700 "$runtime"
export XDG_RUNTIME_DIR="$runtime"
export XDG_DATA_HOME="$(mktemp -d)"
export XDG_SESSION_TYPE=wayland
export XDG_CURRENT_DESKTOP=GNOME
export WAYLAND_DISPLAY=wayland-0
export NO_AT_BRIDGE=0
export KIKO_E2E_OUT="$(mktemp -d)"
export KIKO_TEST_ARGS="${KIKO_TEST_ARGS:-${*:-wayland_lists}}"

dbus-run-session -- bash -euo pipefail -c '
  gnome-shell --headless --virtual-monitor 1280x1024 --no-x11 >/tmp/kiko-wayland-shell.log 2>&1 &
  pids=($!)
  cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
  trap cleanup EXIT
  for _ in $(seq 1 300); do
    [ -S "$XDG_RUNTIME_DIR/wayland-0" ] && break
    sleep 0.1
  done
  if [ ! -S "$XDG_RUNTIME_DIR/wayland-0" ]; then
    echo "the headless compositor did not start" >&2
    tail -20 /tmp/kiko-wayland-shell.log >&2 || true
    exit 1
  fi
  pipewire >/tmp/kiko-wayland-pipewire.log 2>&1 & pids+=($!)
  wireplumber >/tmp/kiko-wayland-wireplumber.log 2>&1 & pids+=($!)
  /usr/libexec/xdg-desktop-portal >/tmp/kiko-wayland-portal.log 2>&1 & pids+=($!)
  sleep 3
  gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
    --method org.freedesktop.DBus.Properties.Set org.a11y.Status IsEnabled "<true>" >/dev/null 2>&1 || true
  cargo test -p kiko-native-linux --test wayland -- --ignored --test-threads=1 --nocapture $KIKO_TEST_ARGS
  cargo test -p kiko-native-linux --lib -- --ignored --test-threads=1 --nocapture
'
