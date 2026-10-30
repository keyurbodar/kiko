#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="${HOME}/.cargo/bin:/usr/local/cargo/bin:${PATH}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${HOME}/.cache/kiko-desktop-target}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"

os="$(uname -s)"
chrome="${KIKO_CHROME:-}"
if [ -z "$chrome" ]; then
  case "$os" in
    Linux)
      for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
        if command -v "$candidate" >/dev/null 2>&1; then chrome="$(command -v "$candidate")"; break; fi
      done
      ;;
    Darwin)
      for candidate in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
        if [ -x "$candidate" ]; then chrome="$candidate"; break; fi
      done
      ;;
    *)
      for candidate in "/c/Program Files/Google/Chrome/Application/chrome.exe" "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"; do
        if [ -x "$candidate" ]; then chrome="$candidate"; break; fi
      done
      ;;
  esac
fi
if [ -z "$chrome" ]; then
  echo "no Chrome or Chromium found; set KIKO_CHROME" >&2
  exit 1
fi

page="$PWD/crates/kiko-browser/tests/fixtures/page.html"
profile="$(mktemp -d)"
xvfb=""
chrome_pid=""

cleanup() {
  if [ -n "$chrome_pid" ]; then
    kill "$chrome_pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$chrome_pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 "$chrome_pid" 2>/dev/null || true
    wait "$chrome_pid" 2>/dev/null || true
  fi
  if [ -n "$xvfb" ]; then
    kill "$xvfb" 2>/dev/null || true
    wait "$xvfb" 2>/dev/null || true
  fi
  rm -rf "$profile" 2>/dev/null || true
}
trap cleanup EXIT

extra=()
if [ "$os" = "Linux" ]; then
  display=""
  for n in $(seq 90 130); do
    if [ ! -e "/tmp/.X11-unix/X${n}" ]; then display="$n"; break; fi
  done
  if [ -z "$display" ]; then
    echo "no free X display between :90 and :130" >&2
    exit 1
  fi
  Xvfb ":${display}" -screen 0 1280x1024x24 -nolisten tcp >/dev/null 2>&1 &
  xvfb=$!
  for _ in $(seq 1 100); do
    if DISPLAY=":${display}" xdpyinfo >/dev/null 2>&1; then break; fi
    sleep 0.1
  done
  export DISPLAY=":${display}"
  if [ "$(id -u)" = "0" ]; then extra+=(--no-sandbox); fi
fi

if command -v cygpath >/dev/null 2>&1; then
  profile_arg="$(cygpath -m "$profile")"
  page_url="file:///$(cygpath -m "$page")"
else
  profile_arg="$profile"
  page_url="file://${page}"
fi

"$chrome" \
  --user-data-dir="$profile_arg" \
  --remote-debugging-port=0 \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --disable-component-update \
  --disable-features=Translate \
  --window-size=1200,900 \
  ${extra[@]+"${extra[@]}"} \
  about:blank >/tmp/kiko-browser-e2e-chrome.log 2>&1 &
chrome_pid=$!

for _ in $(seq 1 200); do
  if [ -s "$profile/DevToolsActivePort" ]; then break; fi
  if ! kill -0 "$chrome_pid" 2>/dev/null; then
    echo "Chrome exited before it opened a debugging port" >&2
    tail -20 /tmp/kiko-browser-e2e-chrome.log >&2 || true
    exit 1
  fi
  sleep 0.1
done
if [ ! -s "$profile/DevToolsActivePort" ]; then
  echo "Chrome never wrote DevToolsActivePort" >&2
  tail -20 /tmp/kiko-browser-e2e-chrome.log >&2 || true
  exit 1
fi

export KIKO_BROWSER_PROFILE_DIRS="$profile_arg"
export KIKO_E2E_PAGE="$page_url"
status=0
cargo test -p kiko-browser --test e2e -- --ignored --test-threads=1 --nocapture || status=$?
if [ "$status" -ne 0 ]; then
  echo "--- Chrome log ---" >&2
  tail -100 /tmp/kiko-browser-e2e-chrome.log >&2 || true
fi
exit "$status"
