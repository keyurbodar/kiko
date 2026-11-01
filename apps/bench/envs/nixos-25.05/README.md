# nixos-25.05

NixOS 25.05 as a QEMU/KVM virtual machine on an `ubuntu-24.04` runner. The flake pins nixpkgs at
`ac62194c3917d5f474c1a844b6fd6da2db95077d` and builds
`nixosConfigurations.bench.config.system.build.vm`. CI caches the built closure keyed on `flake.nix`
and `configuration.nix`, so the VM is not built per job. The machine label carries the nixpkgs
revision: `nixos-25.05@ac62194c3917`.

The desktop session is GNOME on Wayland: `gnome-shell --headless --virtual-monitor 1920x1080`,
started by `session.sh`. The session publishes the socket the compositor actually created
(`WAYLAND_DISPLAY` is the first `wayland-*` socket in `$XDG_RUNTIME_DIR`, not always `wayland-0`)
and keeps `DISPLAY=:0` for XWayland clients.

Display stack: `wayland`, compositor `gnome-shell` 48 headless, XWayland on `:0`. The desktop
fixture and its `xdotool` oracle are X11 clients, so until the oracles stop needing X11 they run
through XWayland (W33d). The sentinel's GTK witness also runs as an X11 client, which is why
`DISPLAY` stays exported.

The repo is shared into the VM over 9p (`/tmp/kiko-bench-repo` on the host, `/mnt/repo` in the VM),
then copied to `~/repo`. SSH is forwarded on host port 2222 with the disposable `bench` user.

CI writes the exact versions to `results/env-versions-nixos-25.05.txt` with `nixos-version` and the
package set, and uploads them with the run artifact.

## Packages

| package | nixpkgs revision |
|---|---|
| git | 2.49 |
| python3 | 3.12 |
| nodejs | 22 |
| bun | 1.3 |
| chromium | 138 |
| vim | 9.1 |
| tmux | 3.5a |
| sqlite | 3.49 |
| jq | 1.7.1 |
| libreoffice-fresh | 25.2 |
| gnome-text-editor (text editor) | 48 |
| gnome-shell | 48 |
