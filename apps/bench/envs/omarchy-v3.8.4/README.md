# omarchy-v3.8.4

Arch Linux plus Omarchy at the pinned release tag `v3.8.4`, as a QEMU/KVM virtual machine on an
`ubuntu-24.04` runner.

The image is built once and cached: the pinned Arch cloud image
(`Arch-Linux-x86_64-cloudimg-20261015.611680.qcow2`, sha256 `08754e28d91b…`) is booted with a
cloud-init NoCloud seed, then Omarchy's own install tree at the tag is run unattended. The machine
label carries the tag and the Arch image digest: `omarchy-v3.8.4@08754e28d91b`.

## Why this is not `install.sh` verbatim

Omarchy's top-level `install.sh` guards on a live ISO: btrfs root, Limine, a fresh vanilla Arch, and
a `gum confirm` when a guard fails. It also runs the login and bootloader phases (Plymouth, SDDM,
Limine snapshots) that only make sense on a real install. `install.sh` in this directory drives the
same install tree at the tag (packaging, config, themes) without the live-ISO-only guards and boot
phases, so it can run unattended on a cloud image. The package source is Omarchy's own
`[omarchy]` pacman repository at the pinned stable mirror.

The desktop session is Hyprland on Wayland with the wlroots headless backend
(`WLR_BACKENDS=headless`), started by `session.sh`. XWayland is available for X11 clients. Desktop
fixtures are launched as native Wayland clients (`GDK_BACKEND=wayland`, pointed at the session's
Wayland socket), and their oracles drive them through a control socket rather than synthesised
input. The session itself is native Wayland; nothing falls back to an X11 session.

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
| Omarchy dotfiles and themes | v3.8.4 |
