#!/usr/bin/env bash
set -euo pipefail

assets="${1:?usage: installer-e2e.sh <assets-dir> <port>}"
port="${2:?usage: installer-e2e.sh <assets-dir> <port>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
site="$(mktemp -d)"
origin="http://127.0.0.1:$port"
pair="$origin/pc#e2e"
os="$(uname -s)"
shell="${KIKO_E2E_SHELL:-sh}"
server=""

fail() {
  echo "installer e2e: $*" >&2
  if [ "$os" = Darwin ]; then
    tail -n 40 "$HOME/Library/Application Support/kiko/kiko.log" 2>/dev/null || true
    tail -n 40 "$HOME/Library/Application Support/kiko-computer/daemon.log" 2>/dev/null || true
  else
    tail -n 40 "$HOME/.config/kiko/kiko.log" 2>/dev/null || true
    tail -n 40 "$HOME/.config/kiko-computer/daemon.log" 2>/dev/null || true
  fi
  exit 1
}

cleanup() {
  if [ "$os" = Darwin ]; then
    "$HOME/Applications/kiko.app/Contents/MacOS/kiko" --quit >/dev/null 2>&1 || true
  else
    "$HOME/.local/share/kiko/kiko" --quit >/dev/null 2>&1 || true
  fi
  if [ -n "$server" ]; then kill "$server" 2>/dev/null || true; fi
  rm -rf "$site"
}
trap cleanup EXIT

seed_old_install() {
  mkdir -p "$HOME/.kiko-computer/bin"
  printf '#!/bin/sh\n' > "$HOME/.kiko-computer/bin/kiko-computer"
  chmod +x "$HOME/.kiko-computer/bin/kiko-computer"
  if [ "$os" = Darwin ]; then
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Application Support/kiko-computer"
    for label in com.kiko.computer com.kiko.computer.move; do
      cat > "$HOME/Library/LaunchAgents/$label.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$HOME/.kiko-computer/bin/kiko-computer-host</string>
    <string>supervise</string>
    <string>$HOME/.kiko-computer/bin/kiko-computer</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST
    done
    touch "$HOME/Library/Application Support/kiko-computer/keep-me"
  else
    mkdir -p "$HOME/.config/systemd/user" "$HOME/.config/kiko-computer"
    printf '[Unit]\nDescription=old kiko-computer\n' > "$HOME/.config/systemd/user/kiko-computer.service"
    touch "$HOME/.config/kiko-computer/keep-me"
  fi
}

wait_until() {
  local tries=$1
  shift
  for _ in $(seq 1 "$tries"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 0.2
  done
  return 1
}

kiko_running() { pgrep -x kiko >/dev/null; }
core_running() { pgrep -x kiko-core >/dev/null; }

check_child() {
  wait_until 150 core_running || fail "kiko-core is not running"
  local app core parent
  app="$(pgrep -x kiko | head -1)"
  core="$(pgrep -x kiko-core | head -1)"
  parent="$(ps -o ppid= -p "$core" | tr -d ' ')"
  [ "$parent" = "$app" ] || fail "kiko-core ($core) is not a child of kiko ($app), its parent is $parent"
  echo "kiko ($app) is running kiko-core ($core)"
}

check_driver() {
  local socket
  if [ "$os" = Darwin ]; then
    socket="$HOME/Library/Application Support/kiko/driver.sock"
  else
    socket="${XDG_CONFIG_HOME:-$HOME/.config}/kiko/driver.sock"
  fi
  wait_until 150 test -S "$socket" || fail "no driver socket at $socket"
  bun "$root/scripts/installer-e2e.ts" status "$socket" || fail "the driver socket did not answer status"
}

check_mac() {
  local app="$HOME/Applications/kiko.app"
  [ -x "$app/Contents/MacOS/kiko" ] || fail "no kiko in $app"
  [ -x "$app/Contents/MacOS/kiko-core" ] || fail "no kiko-core in $app"
  [ ! -e "$HOME/.kiko-computer" ] || fail "the old daemon directory is still there"
  [ ! -e "$HOME/Library/LaunchAgents/com.kiko.computer.move.plist" ] || fail "the move job is still there"
  [ -e "$HOME/Library/Application Support/kiko-computer/keep-me" ] || fail "the old config directory was deleted"
  local program
  program="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$HOME/Library/LaunchAgents/com.kiko.computer.plist")"
  [ "$program" = "$app/Contents/MacOS/kiko" ] || fail "the LaunchAgent runs $program, not $app"
  local expected actual
  expected="$(cat "$root/apps/desktop/macos-requirement.txt")"
  actual="$(codesign -d -r- "$app" 2>&1 | sed -n 's/^designated => //p')"
  [ "$actual" = "$expected" ] || fail "the installed app's designated requirement changed: $actual"
  echo "the LaunchAgent runs $program and its designated requirement is unchanged"
}

check_linux() {
  [ -x "$HOME/.local/share/kiko/kiko" ] || fail "no kiko in ~/.local/share/kiko"
  [ -x "$HOME/.local/share/kiko/kiko-core" ] || fail "no kiko-core in ~/.local/share/kiko"
  [ -f "$HOME/.local/share/applications/kiko.desktop" ] || fail "no desktop entry"
  [ ! -e "$HOME/.kiko-computer" ] || fail "the old daemon directory is still there"
  [ ! -e "$HOME/.config/systemd/user/kiko-computer.service" ] || fail "the old systemd unit is still there"
  [ -e "$HOME/.config/kiko-computer/keep-me" ] || fail "the old config directory was deleted"
  echo "the app, its desktop entry and the old config directory are in place"
}

seed_old_install

bun "$root/scripts/installer-e2e.ts" serve "$assets" "$site" "$port" &
server=$!

wait_until 100 curl -fsS "$origin/install.sh" || fail "the release site did not come up on $origin"

echo "running the installer"
"$shell" "$site/install.sh" "$pair"

wait_until 150 kiko_running || fail "kiko is not running after the install"
app_pid="$(pgrep -x kiko | head -1)"
check_child
check_driver
if [ "$os" = Darwin ]; then check_mac; else check_linux; fi

echo "running the installer again"
again="$("$shell" "$site/install.sh" 2>&1)"
case "$again" in
  *"is already installed"*) ;;
  *) fail "a rerun did not skip the download: $again" ;;
esac
[ "$(pgrep -x kiko | head -1)" = "$app_pid" ] || fail "a rerun restarted the app"
check_child

echo "installing a newer version over the running app"
bun "$root/scripts/installer-e2e.ts" write "$assets" "$site" "$port" "$(bun "$root/scripts/installer-e2e.ts" version)-e2e"
"$shell" "$site/install.sh"
wait_until 150 kiko_running || fail "kiko is not running after the update"
[ "$(pgrep -x kiko | head -1)" != "$app_pid" ] || fail "the update did not restart the app"
check_child
check_driver
echo "installer e2e passed"
