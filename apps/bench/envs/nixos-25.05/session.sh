#!/usr/bin/env bash
set -euo pipefail

export PATH="/run/current-system/sw/bin:/usr/local/bin:$PATH"

if [ "$#" -eq 0 ]; then
  echo "usage: session.sh <command...>" >&2
  exit 2
fi

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
export XDG_SESSION_TYPE=wayland
export XDG_CURRENT_DESKTOP=GNOME
export DISPLAY=:0
export NO_AT_BRIDGE=0
export GTK_A11Y=atspi
export GI_TYPELIB_PATH="/run/current-system/sw/lib/girepository-1.0:${GI_TYPELIB_PATH:-}"
export LIBGL_ALWAYS_SOFTWARE=1

exec dbus-run-session -- bash -c '
  env -u DISPLAY gnome-shell --headless --virtual-monitor 1920x1080 >/tmp/gnome-shell.log 2>&1 &
  shell=$!
  socket=""
  for _ in $(seq 1 240); do
    socket=$(ls "$XDG_RUNTIME_DIR"/wayland-* 2>/dev/null | head -n 1 || true)
    if [ -n "$socket" ]; then break; fi
    if ! kill -0 "$shell" 2>/dev/null; then
      echo "gnome-shell exited before the session came up" >&2
      tail -n 200 /tmp/gnome-shell.log >&2 || true
      exit 1
    fi
    sleep 0.5
  done
  if [ -z "$socket" ]; then
    echo "gnome-shell never published a Wayland socket in $XDG_RUNTIME_DIR" >&2
    tail -n 200 /tmp/gnome-shell.log >&2 || true
    exit 1
  fi
  export WAYLAND_DISPLAY="$(basename "$socket")"
  for _ in $(seq 1 120); do
    if DISPLAY=:0 xdotool getdisplaygeometry >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
  if ! DISPLAY=:0 xdotool getdisplaygeometry >/dev/null 2>&1; then
    echo "warning: XWayland is not answering on DISPLAY=:0, so the X11 fixture will not start" >&2
    tail -n 50 /tmp/gnome-shell.log >&2 || true
  fi
  gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
    --method org.freedesktop.DBus.Properties.Set org.a11y.Status IsEnabled "<true>" >/dev/null 2>&1 || true
  exec "$@"
' bash "$@"
