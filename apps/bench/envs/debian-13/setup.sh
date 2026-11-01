#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  at-spi2-core \
  ca-certificates \
  curl \
  dbus-x11 \
  fonts-dejavu-core \
  gir1.2-gtk-3.0 \
  git \
  jq \
  less \
  libglib2.0-bin \
  libreoffice-calc \
  libreoffice-writer \
  make \
  mousepad \
  nodejs \
  openssh-client \
  openssh-server \
  python3 \
  python3-gi \
  sqlite3 \
  tmux \
  unzip \
  vim \
  x11-utils \
  xauth \
  xdotool \
  xfce4-panel \
  xfce4-session \
  xfwm4 \
  xvfb \
  zip

apt-get install -y --no-install-recommends chromium || apt-get install -y --no-install-recommends chromium-browser
