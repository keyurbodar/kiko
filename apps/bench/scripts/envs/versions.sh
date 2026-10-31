#!/usr/bin/env bash
set -uo pipefail

version_of() {
  local name="$1"
  shift
  local out
  out="$("$@" 2>/dev/null | head -n 1 || true)"
  printf '%s\t%s\n' "$name" "${out:-missing}"
}

echo "## os"
uname -a
cat /etc/os-release 2>/dev/null || sw_vers 2>/dev/null || true
echo

echo "## tools"
version_of git git --version
version_of python3 python3 --version
version_of node node --version
version_of bun bun --version
version_of vim vim --version
version_of tmux tmux -V
version_of sqlite3 sqlite3 --version
version_of jq jq --version
version_of make make --version
version_of chromium chromium --version
version_of libreoffice libreoffice --version
echo

if command -v nixos-version >/dev/null 2>&1; then
  echo "## nixos"
  nixos-version
  echo
fi
if command -v pacman >/dev/null 2>&1; then
  echo "## pacman"
  pacman -Q git python nodejs bun chromium vim tmux sqlite jq libreoffice-fresh hyprland 2>/dev/null || true
  echo
fi
if command -v dpkg-query >/dev/null 2>&1; then
  echo "## dpkg"
  dpkg-query -W -f='${Package}\t${Version}\n' \
    git python3 nodejs chromium vim tmux sqlite3 jq libreoffice-writer xfce4-session xdotool 2>/dev/null || true
  echo
fi
if command -v hyprctl >/dev/null 2>&1; then
  echo "## hyprland"
  hyprctl version 2>/dev/null || true
  echo
fi
if command -v gnome-shell >/dev/null 2>&1; then
  echo "## gnome"
  gnome-shell --version 2>/dev/null || true
  echo
fi
