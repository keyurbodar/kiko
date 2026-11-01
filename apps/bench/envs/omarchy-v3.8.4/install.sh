#!/usr/bin/env bash
set -uo pipefail

tag="v3.8.4"
export OMARCHY_PATH="$HOME/.local/share/omarchy"
export OMARCHY_INSTALL="$OMARCHY_PATH/install"
export PATH="$OMARCHY_PATH/bin:$PATH"

sudo pacman-key --init
sudo pacman-key --populate archlinux
sudo pacman -Syu --noconfirm
sudo pacman -S --noconfirm --needed git base-devel gum openssh xdotool limine

rm -rf "$OMARCHY_PATH"
git clone --depth 1 --branch "$tag" https://github.com/omacom/omarchy.git "$OMARCHY_PATH"

sudo cp -f "$OMARCHY_PATH/default/pacman/pacman-stable.conf" /etc/pacman.conf
sudo cp -f "$OMARCHY_PATH/default/pacman/mirrorlist-stable" /etc/pacman.d/mirrorlist
sudo pacman -Sy --noconfirm
missing=0
for pkg in bash mesa llvm-libs harfbuzz poppler chromium; do
  url="$(pacman -Sp --print-format '%l' "$pkg" 2>/dev/null | head -n 1)"
  if [ -z "$url" ] || ! curl -fsSL --max-time 30 -o /dev/null "$url"; then
    echo "== the omarchy stable mirror does not serve $pkg"
    missing=1
  fi
done
if [ "$missing" = 1 ]; then
  echo "== using Arch's official mirrors for core, extra and multilib"
  printf 'Server = https://geo.mirror.pkgbuild.com/$repo/os/$arch\n' | sudo tee /etc/pacman.d/mirrorlist >/dev/null
  sudo pacman -Syy --noconfirm
fi

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

for pkg in git python python-gobject nodejs bun chromium vim tmux sqlite jq libreoffice-fresh gtk3 curl zip unzip make; do
  sudo pacman -S --noconfirm --needed "$pkg" || echo "!! $pkg failed" >&2
done

df -h /

for cmd in Hyprland hyprctl chromium bun; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "!! $cmd is not installed, so the image is not usable" >&2
    exit 1
  fi
done

echo "omarchy $tag installed from $OMARCHY_PATH"
