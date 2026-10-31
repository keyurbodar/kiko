#!/usr/bin/env bash
set -euo pipefail

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1

brew install git python3 node bun vim tmux sqlite jq
brew install --cask libreoffice

if [ ! -d "/Applications/Chromium.app" ] && [ ! -d "/Applications/Google Chrome.app" ]; then
  brew install --cask chromium
fi
