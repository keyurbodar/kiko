#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: display.sh <command...>" >&2
  exit 2
fi

if [ -n "${DISPLAY:-}" ]; then
  exec "$@"
fi

export NO_AT_BRIDGE=0
export GDK_BACKEND=x11
export LANG=C.UTF-8

exec dbus-run-session -- xvfb-run -a -s "-screen 0 1920x1080x24" bash -c '
  xfce4-session >/tmp/xfce4-session.log 2>&1 &
  for _ in $(seq 1 100); do
    if xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q "window id"; then break; fi
    sleep 0.1
  done
  clients=""
  settled=0
  for _ in $(seq 1 200); do
    now="$(xprop -root _NET_CLIENT_LIST 2>/dev/null || true)"
    if [ -n "$now" ] && [ "$now" = "$clients" ]; then
      settled=$((settled + 1))
      if [ "$settled" -ge 5 ]; then break; fi
    else
      settled=0
    fi
    clients="$now"
    sleep 0.1
  done
  gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
    --method org.freedesktop.DBus.Properties.Set org.a11y.Status IsEnabled "<true>" >/dev/null 2>&1 || true
  exec "$@"
' bash "$@"
