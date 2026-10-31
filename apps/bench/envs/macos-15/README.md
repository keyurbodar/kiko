# macos-15

The GitHub `macos-15` runner, Aqua session, as before. `setup.sh` installs the environment packages
with Homebrew. The machine label is `macos-15`.

The desktop track does not run here: every desktop task lists `os: ["linux"]`, and the GTK fixture
and its `xdotool` oracle are X11-only. Terminal and browser tasks that list macOS do run.

CI writes the exact versions to `results/env-versions-macos-15.txt` with `sw_vers` and the Homebrew
package versions, and uploads them with the run artifact.

## Packages

| package | runner version |
|---|---|
| git | preinstalled, 2.5x |
| python3 | Homebrew, 3.13 |
| node | 24 (setup-node) |
| bun | 1.3.14 (setup-bun) |
| Chrome / Chromium | preinstalled Chrome 14x |
| vim | preinstalled |
| tmux | preinstalled |
| sqlite3 | preinstalled |
| jq | Homebrew, 1.8 |
| libreoffice | Homebrew cask, 25.8 |
| TextEdit (text editor) | preinstalled |
