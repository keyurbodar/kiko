# nixos-25.05

NixOS 25.05 as a QEMU/KVM virtual machine on an `ubuntu-24.04` runner. The flake pins nixpkgs at
`ac62194c3917d5f474c1a844b6fd6da2db95077d` and builds
`nixosConfigurations.bench.config.system.build.vm`. CI caches the built closure keyed on `flake.nix`
and `configuration.nix`, so the VM is not built per job. The machine label carries the nixpkgs
revision: `nixos-25.05@ac62194c3917`.

The desktop session is GNOME on Wayland: `gnome-shell --headless --virtual-monitor 1920x1080`,
started by `session.sh`. XWayland is available for X11 clients. Desktop fixtures are launched as
native Wayland clients (`GDK_BACKEND=wayland`, pointed at the session's Wayland socket), and their
oracles drive them through a control socket rather than synthesised input. The session itself is
native Wayland; nothing falls back to an X11 session.

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
