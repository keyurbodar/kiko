# omarchy-v3.8.4

Arch Linux plus Omarchy at the pinned release tag `v3.8.4`, as a QEMU/KVM virtual machine on an
`ubuntu-24.04` runner.

The image is built from the pinned Arch cloud image
(`Arch-Linux-x86_64-cloudimg-20261015.611680.qcow2`, sha256 `08754e28d91b…`) booted with a
cloud-init NoCloud seed, then Omarchy's own install tree at the tag is run unattended. The machine
label carries the tag and the Arch image digest: `omarchy-v3.8.4@08754e28d91b`.

The finished image is about 9 GB, which does not survive the 10 GB Actions cache quota. The image
job builds it, saves it only when it comes in under 2 GB, and every VM job builds its own copy when
the restore misses. The build takes about eight minutes because `install.sh` drops the pacman cache
and the build caches before the image is compressed.

## Why this is not `install.sh` verbatim

Omarchy's top-level `install.sh` guards on a live ISO: btrfs root, Limine, a fresh vanilla Arch, and
a `gum confirm` when a guard fails. It also runs the login and bootloader phases (Plymouth, SDDM,
Limine snapshots) that only make sense on a real install. `install.sh` in this directory drives the
same install tree at the tag (packaging, config, themes) without the live-ISO-only guards and boot
phases, so it can run unattended on a cloud image. The package source is Omarchy's own
`[omarchy]` pacman repository at the pinned stable mirror.

The desktop session is Hyprland on Wayland, started by `session.sh`. Hyprland 0.57 and aquamarine
0.15 ignore the old `WLR_BACKENDS=headless` knobs and need a seat and a DRM card to open their
headless backend, so the VM boots with `-vga std`, the script fails loudly when `/dev/dri/card0` is
missing, and the compositor runs with `LIBSEAT_BACKEND=seatd` against a `seatd` started for the
`bench` group. The script then publishes the socket Hyprland really created (`WAYLAND_DISPLAY` is
the first `wayland-*` socket in `$XDG_RUNTIME_DIR`; Hyprland 0.57 does not use
`hypr/<signature>/.wayland.sock`) and sizes the output `hyprctl` reports (`Virtual-1`) instead of a
`HEADLESS-1` that does not exist. Typing goes through `wtype`, with `ydotoold` as the fallback.

Display stack: `wayland`, compositor `hyprland` 0.57 with the aquamarine headless backend on DRM,
XWayland on `:0`. The desktop fixture and its `xdotool` oracle are X11 clients, so until the oracles
stop needing X11 they run through XWayland (W33d). The sentinel types with `wtype` on the native
Wayland socket and watches the GTK witness over X11.

CI writes the exact versions to `results/env-versions-omarchy-v3.8.4.txt` with `pacman -Q`, and
uploads them with the run artifact.

## Packages

| package | version at the 2026-10-15 Arch image + Omarchy v3.8.4 |
|---|---|
| git | 2.51 |
| python | 3.13 |
| nodejs | 24 |
| bun | 1.3 |
| chromium | 143 |
| vim | 9.1 |
| tmux | 3.5a |
| sqlite | 3.50 |
| jq | 1.8.1 |
| libreoffice-fresh | 25.8 |
| hyprland | from the Omarchy repo at v3.8.4 |
| seatd | 0.9 |
| wtype, ydotool | 0.4, 1.0 |
| python-xlib | 0.33 |
| Omarchy dotfiles and themes | v3.8.4 |
