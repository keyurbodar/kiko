# debian-13

Debian 13 (trixie) in a container on an `ubuntu-24.04` runner. The job's steps run inside
`debian:trixie`, and the bench process, its terminal manager, cua-driver and agent-browser all run
there. The desktop session is Xfce on X11: `Xvfb` plus `xfce4-session`, started by `display.sh`.

Display stack: `x11`, `Xvfb` on `:0` with `xfce4-session` 4.20. There is no Wayland here, so the
fixture, the oracles and the sentinel's GTK witness all talk X11 directly.

`setup.sh` installs the environment packages with `apt`. CI writes the exact versions it got to
`results/env-versions-debian-13.txt` and uploads them with the run artifact.

## Packages

| package | trixie version at the 2026-10-31 image |
|---|---|
| git | 1:2.47.3-0+deb13u1 |
| python3 | 3.13 |
| nodejs | 20.19.2+dfsg-1+deb13u2 |
| bun | 1.3.14 (setup-bun) |
| chromium | 150.0.7871.181-1~deb13u1 |
| vim | 2:9.1.1230-2 |
| tmux | 3.5a-3 |
| sqlite3 | 3.46.1-7+deb13u2 |
| jq | 1.7.1-6+deb13u3 |
| libreoffice-writer | 25.2 |
| mousepad (text editor) | 0.6.2 |
| xfce4-session | 4.20.2-2 |
| xdotool | 1:3.20160805.1-5.1 |
| python3-xlib | 0.33-1 |
