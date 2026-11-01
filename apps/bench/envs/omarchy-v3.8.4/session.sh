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
unset HYPRLAND_INSTANCE_SIGNATURE
export XDG_SESSION_TYPE=wayland
export XDG_CURRENT_DESKTOP=Hyprland
export HYPRLAND_NO_SD_NOTIFY=1
export DISPLAY=:0
export NO_AT_BRIDGE=0
export LIBSEAT_BACKEND=seatd
export YDOTOOL_SOCKET="$XDG_RUNTIME_DIR/.ydotool_socket"

if [ ! -e /dev/dri/card0 ]; then
  echo "no /dev/dri/card0 in this VM, so Hyprland has no primary allocator to start with" >&2
  echo "run qemu with -device virtio-vga (or -vga std) so the guest gets a drm card" >&2
  ls -l /dev/dri 2>/dev/null || echo "/dev/dri does not exist" >&2
  exit 1
fi

if command -v seatd >/dev/null 2>&1; then
  sudo -n seatd -g bench >/tmp/seatd.log 2>&1 &
fi

exec dbus-run-session -- bash -c '
  if command -v ydotoold >/dev/null 2>&1; then
    sudo -n ydotoold --socket-path "$YDOTOOL_SOCKET" --socket-perm 0600 >/tmp/ydotoold.log 2>&1 &
  fi
  env -u DISPLAY Hyprland >/tmp/hyprland.log 2>&1 &
  hypr=$!
  signature=""
  for _ in $(seq 1 240); do
    signature=$(ls "$XDG_RUNTIME_DIR/hypr" 2>/dev/null | head -n 1 || true)
    if [ -n "$signature" ] && HYPRLAND_INSTANCE_SIGNATURE="$signature" hyprctl version >/dev/null 2>&1; then break; fi
    if ! kill -0 "$hypr" 2>/dev/null; then
      echo "Hyprland exited before the session came up" >&2
      tail -n 200 /tmp/hyprland.log >&2 || true
      tail -n 50 /tmp/seatd.log >&2 || true
      exit 1
    fi
    sleep 0.5
  done
  if [ -z "$signature" ]; then
    echo "Hyprland never answered hyprctl within 120 s" >&2
    tail -n 200 /tmp/hyprland.log >&2 || true
    exit 1
  fi
  export HYPRLAND_INSTANCE_SIGNATURE="$signature"
  socket=""
  for candidate in "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR/hypr/$signature/.wayland.sock"; do
    if [ -S "$candidate" ]; then socket="$candidate"; break; fi
  done
  if [ -z "$socket" ]; then
    echo "Hyprland published no Wayland socket in $XDG_RUNTIME_DIR" >&2
    ls -l "$XDG_RUNTIME_DIR" >&2 || true
    exit 1
  fi
  if [ "$socket" = "$XDG_RUNTIME_DIR/hypr/$signature/.wayland.sock" ]; then
    export WAYLAND_DISPLAY="hypr/$signature/.wayland.sock"
  else
    export WAYLAND_DISPLAY="$(basename "$socket")"
  fi
  output=$(hyprctl monitors -j 2>/dev/null | jq -r '.[0].name // empty' || true)
  if [ -n "$output" ]; then
    hyprctl keyword monitor "$output,1920x1080@60,0x0,1" >/dev/null 2>&1 || true
  fi
  hyprctl monitors || true
  for _ in $(seq 1 120); do
    if DISPLAY=:0 xdotool getdisplaygeometry >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
  if ! DISPLAY=:0 xdotool getdisplaygeometry >/dev/null 2>&1; then
    echo "warning: XWayland is not answering on DISPLAY=:0, so the X11 fixture will not start" >&2
    tail -n 50 /tmp/hyprland.log >&2 || true
  fi
  gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
    --method org.freedesktop.DBus.Properties.Set org.a11y.Status IsEnabled "<true>" >/dev/null 2>&1 || true
  exec "$@"
' bash "$@"
