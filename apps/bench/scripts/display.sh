#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: display.sh <command...>" >&2
  exit 2
fi

if [ -n "${DISPLAY:-}" ]; then
  exec "$@"
fi

exec dbus-run-session -- xvfb-run -a -s "-screen 0 1280x1024x24" bash -c '
  openbox --sm-disable >/dev/null 2>&1 &
  gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
    --method org.freedesktop.DBus.Properties.Set org.a11y.Status IsEnabled "<true>" >/dev/null 2>&1 || true
  exec "$@"
' bash "$@"
