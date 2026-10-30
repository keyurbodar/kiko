#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="${HOME}/.cargo/bin:${PATH}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${HOME}/.cache/kiko-desktop-target}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"

display=""
for n in $(seq 90 130); do
  if [ ! -e "/tmp/.X11-unix/X${n}" ]; then
    display="$n"
    break
  fi
done
if [ -z "$display" ]; then
  echo "no free X display between :90 and :130" >&2
  exit 1
fi

Xvfb ":${display}" -screen 0 1280x1024x24 -nolisten tcp >/dev/null 2>&1 &
xvfb=$!
cleanup() {
  kill "$xvfb" 2>/dev/null || true
}
trap cleanup EXIT
for _ in $(seq 1 100); do
  if DISPLAY=":${display}" xdpyinfo >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
export DISPLAY=":${display}"
export NO_AT_BRIDGE=0

dbus-run-session -- bash -euo pipefail -c '
  openbox --sm-disable >/dev/null 2>&1 &
  openbox_pid=$!
  trap "kill $openbox_pid 2>/dev/null || true" EXIT
  gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
    --method org.freedesktop.DBus.Properties.Set org.a11y.Status IsEnabled "<true>" >/dev/null 2>&1 || true
  cargo test --test e2e -- --ignored --test-threads=1
'
