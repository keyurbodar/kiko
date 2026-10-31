#!/usr/bin/env bash
set -uo pipefail

tag="v3.8.4"
export OMARCHY_PATH="$HOME/.local/share/omarchy"
export OMARCHY_INSTALL="$OMARCHY_PATH/install"
export PATH="$OMARCHY_PATH/bin:$PATH"

sudo pacman -Syu --noconfirm
sudo pacman -S --noconfirm --needed git base-devel gum openssh xdotool limine

rm -rf "$OMARCHY_PATH"
git clone --depth 1 --branch "$tag" https://github.com/omacom/omarchy.git "$OMARCHY_PATH"

sudo cp -f "$OMARCHY_PATH/default/pacman/pacman-stable.conf" /etc/pacman.conf
sudo cp -f "$OMARCHY_PATH/default/pacman/mirrorlist-stable" /etc/pacman.d/mirrorlist
sudo pacman -Sy --noconfirm

run() {
  local script="$1"
  echo "== $script"
  if ! bash -c "source '$script'"; then echo "!! $script failed" >&2; fi
}

install_base_packages() {
  local pkg
  while IFS= read -r pkg; do
    case "$pkg" in '' | \#*) continue ;; esac
    echo "== package $pkg"
    omarchy-pkg-add "$pkg" || echo "!! package $pkg failed" >&2
  done <"$OMARCHY_INSTALL/omarchy-base.packages"
}

install_base_packages
run "$OMARCHY_INSTALL/packaging/fonts.sh"
run "$OMARCHY_INSTALL/packaging/icons.sh"
run "$OMARCHY_INSTALL/packaging/tuis.sh"
run "$OMARCHY_INSTALL/packaging/nvim.sh"
run "$OMARCHY_INSTALL/packaging/webapps.sh"

run "$OMARCHY_INSTALL/config/config.sh"
run "$OMARCHY_INSTALL/config/theme.sh"
run "$OMARCHY_INSTALL/config/branding.sh"
run "$OMARCHY_INSTALL/config/xcompose.sh"
run "$OMARCHY_INSTALL/config/increase-file-watchers.sh"
run "$OMARCHY_INSTALL/config/increase-fd-limit.sh"
run "$OMARCHY_INSTALL/config/mimetypes.sh"
run "$OMARCHY_INSTALL/config/user-dirs.sh"

mkdir -p "$HOME/.config/hypr"
printf 'monitor=HEADLESS-1,1920x1080@60,0x0,1\n' >"$HOME/.config/hypr/monitors.conf"

for pkg in git python nodejs bun chromium vim tmux sqlite jq libreoffice-fresh; do
  sudo pacman -S --noconfirm --needed "$pkg" || echo "!! $pkg failed" >&2
done

echo "omarchy $tag installed from $OMARCHY_PATH"
