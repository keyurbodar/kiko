import { computerSums } from "@kiko/computer/install"
import { parseManifest, verifyRelease } from "@kiko/durable/release"
import type { Env } from "../index"
import { updateConfig } from "../lib/release-config"
import { BACKEND } from "../lib/version"

type ComputerRelease = { version: string; base: string; sums: string }

const CACHE = "public, max-age=300"
const UNAVAILABLE = "this worker has no signed kiko release to install right now; try again later"

const shQuote = (value: string): string => value.replace(/'/g, `'\\''`)
const psQuote = (value: string): string => value.replace(/'/g, "''")

async function computerRelease(env: Env): Promise<ComputerRelease | null> {
  const config = updateConfig(env, null)
  const dir = `${config.releaseBase.replace(/\/$/, "")}/${BACKEND.version}`
  try {
    const [manifest, signature] = await Promise.all([fetch(`${dir}/manifest.json`), fetch(`${dir}/manifest.sig`)])
    if (!manifest.ok || !signature.ok) return null
    const bytes = new Uint8Array(await manifest.arrayBuffer())
    if (!(await verifyRelease(bytes, await signature.text(), config.publicKey))) return null
    const computer = parseManifest(bytes)?.computer
    if (!computer || computer.version !== BACKEND.version) return null
    return { version: computer.version, base: computer.base.replace(/\/$/, ""), sums: computerSums(computer.assets) }
  } catch {
    return null
  }
}

const SH_HELPERS = `say() { printf '%s\\n' "$*"; }
step() { step=$((\${step:-0} + 1)); printf 'kiko: [%s/%s] %s\\n' "$step" "$steps" "$*"; }
die() { printf 'kiko: %s\\n' "$*" >&2; exit 1; }

download() {
  if command -v curl >/dev/null 2>&1; then
    if [ -t 2 ]; then
      curl -fL --progress-bar "$1" -o "$2"
    else
      curl -fsSL "$1" -o "$2"
    fi
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die "curl or wget is needed to download kiko"
  fi
}

hash_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | sed 's/^.*= *//'
  else
    die "no sha256 tool found. Install coreutils, perl or openssl, then run this again"
  fi
}

checksum_of() {
  printf '%s\\n' "$sums" | awk -v asset="$1" '{ name = $2; sub(/^\\*/, "", name) } name == asset { print tolower($1); exit }'
}

xml() {
  printf '%s' "$1" | sed -e 's/&/\\&amp;/g' -e 's/</\\&lt;/g' -e 's/>/\\&gt;/g'
}

wait_gone() {
  n=0
  while "$1" && [ "$n" -lt 50 ]; do
    sleep 0.2
    n=$((n + 1))
  done
}`

const SH_FFMPEG = `install_ffmpeg() {
  if [ "$os" = macos ]; then
    if command -v brew >/dev/null 2>&1; then
      brew install ffmpeg
    else
      return 1
    fi
    return 0
  fi
  sudo=''
  if [ "$(id -u)" != 0 ] && command -v sudo >/dev/null 2>&1; then
    sudo=sudo
  fi
  if command -v apt-get >/dev/null 2>&1; then
    $sudo apt-get update && $sudo apt-get install -y ffmpeg
  elif command -v dnf >/dev/null 2>&1; then
    $sudo dnf install -y ffmpeg
  elif command -v yum >/dev/null 2>&1; then
    $sudo yum install -y ffmpeg
  elif command -v pacman >/dev/null 2>&1; then
    $sudo pacman -S --noconfirm ffmpeg
  elif command -v apk >/dev/null 2>&1; then
    $sudo apk add ffmpeg
  else
    return 1
  fi
}`

const SH_ARGS = `pair=''
pair_name=''
with_ffmpeg=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --with-ffmpeg) with_ffmpeg=1; shift ;;
    --name) [ "$#" -ge 2 ] || die "--name needs a value"; pair_name="$2"; shift 2 ;;
    --name=*) pair_name="\${1#--name=}"; shift ;;
    -*) die "unknown option $1" ;;
    *) pair="$1"; shift ;;
  esac
done
if [ -z "$pair" ]; then pair="\${KIKO_PAIR_URL:-}"; fi`

const SH_MAC = `mac_version() {
  if [ -f "$app/Contents/Info.plist" ]; then
    /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist" 2>/dev/null || true
  fi
}

mac_running() {
  launchctl print "gui/$uid/com.kiko.computer" >/dev/null 2>&1
}

mac_app_process() {
  pgrep -f -- "$app/Contents/MacOS/kiko" >/dev/null 2>&1
}

mac_stop() {
  if mac_running; then launchctl bootout "gui/$uid/com.kiko.computer" >/dev/null 2>&1 || true; fi
  if mac_app_process; then
    "$app/Contents/MacOS/kiko" --quit >/dev/null 2>&1 || true
    wait_gone mac_app_process
  fi
}

mac_replace() {
  mkdir -p "$home/Applications"
  mkdir -p "$work/unpack"
  if command -v ditto >/dev/null 2>&1; then
    ditto -x -k "$work/$asset" "$work/unpack"
  else
    unzip -q "$work/$asset" -d "$work/unpack"
  fi
  [ -d "$work/unpack/kiko.app" ] || die "the archive has no kiko.app"
  mac_stop
  old="$app.replaced"
  rm -rf "$old"
  if [ -d "$app" ]; then mv "$app" "$old"; fi
  mv "$work/unpack/kiko.app" "$app" || die "could not move kiko.app into $home/Applications"
  rm -rf "$old"
}

mac_agent() {
  plist="$home/Library/LaunchAgents/com.kiko.computer.plist"
  mkdir -p "$home/Library/LaunchAgents"
  program="$(xml "$app/Contents/MacOS/kiko")"
  search="$(xml "$PATH")"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.kiko.computer</string>
  <key>ProgramArguments</key>
  <array>
    <string>$program</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$search</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
PLIST
  if [ "$restart" = 1 ] || ! mac_running; then
    launchctl bootout "gui/$uid/com.kiko.computer" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$uid" "$plist" >/dev/null 2>&1 ||
      launchctl kickstart -k "gui/$uid/com.kiko.computer" >/dev/null 2>&1 ||
      die "launchctl could not start kiko from $plist"
  fi
}

mac_migrate() {
  launchctl bootout "gui/$uid/com.kiko.computer.move" >/dev/null 2>&1 || true
  rm -f "$home/Library/LaunchAgents/com.kiko.computer.move.plist"
  if [ -f "$home/.kiko-computer/bin/kiko-computer" ]; then
    rm -rf "$home/.kiko-computer"
  fi
}`

const SH_LINUX = `linux_version() {
  if [ -f "$root/VERSION" ]; then cat "$root/VERSION"; fi
}

linux_app_process() {
  pgrep -f -- "$root/kiko" >/dev/null 2>&1
}

linux_running() {
  if [ "$use_systemd" = 1 ]; then
    systemctl --user is-active --quiet kiko.service
  else
    linux_app_process
  fi
}

linux_replace() {
  mkdir -p "$work/unpack"
  tar -xzf "$work/$asset" -C "$work/unpack" || die "could not unpack $asset"
  [ -f "$work/unpack/kiko" ] || die "the archive has no kiko binary"
  mkdir -p "$root"
  if [ "$use_systemd" = 1 ]; then systemctl --user stop kiko.service >/dev/null 2>&1 || true; fi
  if linux_app_process; then
    "$root/kiko" --quit >/dev/null 2>&1 || true
    wait_gone linux_app_process
  fi
  install -m 755 "$work/unpack/kiko" "$root/.kiko.new"
  install -m 755 "$work/unpack/kiko-core" "$root/.kiko-core.new"
  mv -f "$root/.kiko.new" "$root/kiko"
  mv -f "$root/.kiko-core.new" "$root/kiko-core"
  printf '%s\\n' "$version" > "$root/VERSION"
  if [ -f "$work/unpack/kiko.png" ]; then
    mkdir -p "$home/.local/share/icons/hicolor/256x256/apps"
    install -m 644 "$work/unpack/kiko.png" "$home/.local/share/icons/hicolor/256x256/apps/kiko.png"
  fi
  mkdir -p "$home/.local/share/applications"
  if [ -f "$work/unpack/kiko.desktop" ]; then
    sed -e "s|^Exec=.*|Exec=\\"$root/kiko\\"|" "$work/unpack/kiko.desktop" > "$home/.local/share/applications/kiko.desktop"
  else
    printf '%s\\n' "[Desktop Entry]" "Type=Application" "Name=kiko" "Exec=\\"$root/kiko\\"" "Icon=kiko" \\
      "Terminal=false" "Categories=Utility;" "StartupWMClass=kiko" > "$home/.local/share/applications/kiko.desktop"
  fi
}

linux_environment() {
  adopted=''
  if [ -z "$(printenv DISPLAY 2>/dev/null || true)" ] && [ -z "$(printenv WAYLAND_DISPLAY 2>/dev/null || true)" ]; then
    adopted="$(systemctl --user show-environment 2>/dev/null || true)"
  fi
  for name in DISPLAY WAYLAND_DISPLAY XAUTHORITY XDG_RUNTIME_DIR XDG_SESSION_TYPE DBUS_SESSION_BUS_ADDRESS; do
    value="$(printenv "$name" 2>/dev/null || true)"
    if [ -z "$value" ] && [ -n "$adopted" ]; then
      value="$(printf '%s\\n' "$adopted" | sed -n "s/^$name=//p" | head -1)"
    fi
    if [ -n "$value" ]; then
      escaped="$(printf '%s' "$value" | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g')"
      printf 'Environment="%s=%s"\\n' "$name" "$escaped"
    fi
  done
}

linux_agent() {
  if [ "$use_systemd" = 1 ]; then
    unit="$home/.config/systemd/user/kiko.service"
    mkdir -p "$home/.config/systemd/user"
    cat > "$unit" <<UNIT
[Unit]
Description=kiko
After=network-online.target
After=graphical-session.target
Wants=network-online.target

[Service]
ExecStart="$root/kiko"
$(linux_environment)Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable kiko.service >/dev/null 2>&1 || die "systemctl could not enable kiko.service"
    if [ "$restart" = 1 ] || ! linux_running; then
      systemctl --user restart kiko.service >/dev/null 2>&1 || die "systemctl could not start kiko.service"
    fi
    rm -f "$home/.config/autostart/kiko.desktop"
    return
  fi
  autostart="$home/.config/autostart/kiko.desktop"
  mkdir -p "$home/.config/autostart"
  cat > "$autostart" <<AUTOSTART
[Desktop Entry]
Type=Application
Name=kiko
Comment=The kiko agent on this computer
Exec="$root/kiko"
Terminal=false
X-GNOME-Autostart-enabled=true
AUTOSTART
  if [ "$restart" = 1 ] || ! linux_running; then
    nohup "$root/kiko" >/dev/null 2>&1 &
  fi
}

linux_migrate() {
  old="$home/.config/systemd/user/kiko-computer.service"
  if [ -f "$old" ]; then
    systemctl --user disable --now kiko-computer.service >/dev/null 2>&1 || true
    rm -f "$old"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi
  if [ -f "$home/.kiko-computer/bin/kiko-computer" ]; then
    rm -rf "$home/.kiko-computer"
  fi
}`

export function installSh(origin: string, release: ComputerRelease): string {
  return `#!/bin/sh
set -eu

origin='${shQuote(origin)}'
version='${release.version}'
base='${release.base}'
sums='${release.sums}'

${SH_HELPERS}

${SH_FFMPEG}

${SH_ARGS}

${SH_MAC}

${SH_LINUX}

case "$(uname -s)" in
  Darwin) os=macos ;;
  Linux) os=linux ;;
  *) die "this script installs on macOS and Linux. On Windows use the install.ps1 one-liner from $origin" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) die "unsupported architecture $(uname -m)" ;;
esac

base="\${KIKO_PC_BASE:-$base}"
home="\${KIKO_HOME:-$HOME}"
uid="$(id -u)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM
restart=0

if [ "$os" = macos ]; then
  asset=kiko-macos-universal.zip
  app="$home/Applications/kiko.app"
  core="$app/Contents/MacOS/kiko-core"
  installed="$(mac_version)"
else
  asset="kiko-linux-$arch.tar.gz"
  root="$home/.local/share/kiko"
  core="$root/kiko-core"
  use_systemd=0
  if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
    use_systemd=1
  fi
  installed="$(linux_version)"
fi

if [ "$installed" = "$version" ]; then
  say "kiko: kiko $version is already installed"
  steps=1
else
  steps=3
  if [ -n "$pair" ]; then steps=4; fi
  want="$(checksum_of "$asset")"
  [ -n "$want" ] || die "the release has no checksum for $asset"
  step "downloading $asset $version"
  download "$base/$asset" "$work/$asset" || die "could not download $asset from $base"
  step "checking the download"
  got="$(hash_of "$work/$asset")"
  if [ "$got" != "$want" ]; then
    die "checksum mismatch for $asset: expected $want, got $got. Nothing was installed"
  fi
  step "installing kiko $version"
  if [ "$os" = macos ]; then
    mac_replace
  else
    linux_replace
  fi
  restart=1
fi

if [ -n "$pair" ]; then
  step "pairing with $origin"
  if [ -n "$pair_name" ]; then
    "$core" pair "$pair" --name "$pair_name"
  else
    "$core" pair "$pair"
  fi
elif [ -z "$installed" ]; then
  say "kiko: no pair link yet. Open $origin in a browser, add this computer, then run:"
  say "  $core pair '<pair-url>'"
fi

if [ "$os" = macos ]; then
  mac_agent
  mac_migrate
else
  linux_agent
  linux_migrate
fi

say "kiko: starts at login and is running now"
if [ "$os" = macos ]; then
  say "kiko: macOS asks once for Accessibility and Screen Recording. Open System Settings > Privacy & Security and turn on kiko in both lists. The kiko menu shows when both are granted."
fi

if command -v ffmpeg >/dev/null 2>&1; then
  :
elif [ "$with_ffmpeg" = 1 ]; then
  if ! install_ffmpeg; then
    say "kiko: ffmpeg could not be installed automatically. Get it from https://ffmpeg.org/download.html"
  fi
else
  say "kiko: live view needs ffmpeg. Install it with:"
  say "  macOS: brew install ffmpeg"
  say "  Debian or Ubuntu: sudo apt-get install -y ffmpeg"
  say "  Fedora: sudo dnf install -y ffmpeg"
  say "  Arch: sudo pacman -S ffmpeg"
  say "  Alpine: sudo apk add ffmpeg"
  say "  or run this script again with --with-ffmpeg"
fi

say "kiko: done."
`
}

export function installPs1(origin: string, release: ComputerRelease): string {
  return `param(
  [Parameter(Position = 0)][string]$PairUrl = $env:KIKO_PAIR_URL,
  [string]$Name = '',
  [switch]$WithFfmpeg
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$origin = '${psQuote(origin)}'
$version = '${release.version}'
$base = '${release.base}'
$sums = @'
${release.sums}'@

function Say([string]$Text) { Write-Host "kiko: $Text" }

if ($env:KIKO_PC_BASE) { $base = $env:KIKO_PC_BASE }
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { Say 'Windows on ARM runs the x64 build under emulation' }

$asset = 'kiko-windows-x64.zip'
$local = $env:LOCALAPPDATA
if (-not $local) { $local = Join-Path $env:USERPROFILE 'AppData\\Local' }
$root = Join-Path $local 'kiko'
$exe = Join-Path $root 'kiko.exe'
$core = Join-Path $root 'kiko-core.exe'
$staging = Join-Path $root '.update'
$run = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
$migrate = @'
Remove-ItemProperty -Path '__RUN__' -Name 'kiko-computer' -ErrorAction SilentlyContinue
$old = Get-Process -Name 'kiko-computer' -ErrorAction SilentlyContinue
if ($old) { $old | Stop-Process -Force }
$oldDir = Join-Path '__LOCAL__' 'kiko-computer'
if (Test-Path (Join-Path $oldDir 'bin\\kiko-computer.exe')) { Remove-Item -Recurse -Force $oldDir }
'@
$migrate = $migrate.Replace('__RUN__', $run).Replace('__LOCAL__', $local)

$want = ''
foreach ($line in ($sums -split '\\r?\\n')) {
  $parts = $line.Trim() -split '\\s+'
  if ($parts.Length -ge 2) {
    $candidate = $parts[1] -replace '^\\*', ''
    if ($candidate -eq $asset) { $want = $parts[0].ToLower(); break }
  }
}
if (-not $want) { throw "kiko: the release has no checksum for $asset" }

$same = ''
if (Test-Path (Join-Path $root 'VERSION')) { $same = (Get-Content (Join-Path $root 'VERSION') -Raw).Trim() }
New-Item -ItemType Directory -Force -Path $root | Out-Null

if ($same -eq $version) {
  Say "kiko $version is already installed"
} else {
  New-Item -ItemType Directory -Force -Path $staging | Out-Null
  $zip = Join-Path $staging 'kiko.zip'
  Say "downloading $asset $version"
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $zip
  $got = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
  if ($got -ne $want) {
    Remove-Item -Force $zip
    throw "kiko: checksum mismatch for $asset. Nothing was installed"
  }
  if (Get-Process -Name 'kiko' -ErrorAction SilentlyContinue) {
    Say 'kiko is running, so it quits, replaces itself and starts again'
    $swap = @'
$ErrorActionPreference = 'Stop'
& '__EXE__' --quit
for ($i = 0; $i -lt 60; $i++) {
  if (-not (Get-Process -Name 'kiko' -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 500
}
if (Get-Process -Name 'kiko' -ErrorAction SilentlyContinue) { exit 1 }
Expand-Archive -Path '__ZIP__' -DestinationPath '__ROOT__' -Force
Set-Content -Path (Join-Path '__ROOT__' 'VERSION') -Value '__VERSION__' -NoNewline
Remove-Item -Force '__ZIP__'
Remove-Item -Recurse -Force '__STAGING__'
Start-Process -FilePath '__EXE__'
__MIGRATE__
'@
$swap = $swap.Replace('__EXE__', $exe).Replace('__ZIP__', $zip).Replace('__ROOT__', $root).Replace('__VERSION__', $version).Replace('__STAGING__', $staging).Replace('__MIGRATE__', $migrate)
    $helper = Join-Path $staging 'swap.ps1'
    Set-Content -Path $helper -Value $swap -Encoding UTF8
    Set-ItemProperty -Path $run -Name 'kiko' -Value ('"' + $exe + '"')
    Start-Process -FilePath 'powershell' -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $helper)
    Say 'kiko starts at logon'
    Say 'done.'
    exit 0
  }
  Say "installing kiko $version"
  Expand-Archive -Path $zip -DestinationPath $root -Force
  Set-Content -Path (Join-Path $root 'VERSION') -Value $version -NoNewline
  Remove-Item -Force $zip
  Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
}

Set-ItemProperty -Path $run -Name 'kiko' -Value ('"' + $exe + '"')
Say 'kiko starts at logon'

if ($PairUrl) {
  if ($Name) {
    & $core pair $PairUrl --name $Name
  } else {
    & $core pair $PairUrl
  }
  if ($LASTEXITCODE -ne 0) { throw 'kiko: pairing failed' }
} elseif (-not $same) {
  Say "no pair link yet. Open $origin in a browser, add this computer, then run:"
  Write-Host ('  "' + $core + '" pair "<pair-url>"')
}

if (-not (Get-Process -Name 'kiko' -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath $exe
  Say 'kiko is running now'
}

& ([scriptblock]::Create($migrate))

if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
  Say 'ffmpeg found'
} elseif ($WithFfmpeg -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
} else {
  Say 'ffmpeg is missing. Live view needs it. Install it with:'
  Write-Host '  winget install --id Gyan.FFmpeg -e'
  Write-Host '  or download it from https://ffmpeg.org/download.html'
  Write-Host '  or run this script again with -WithFfmpeg'
}

Say 'done.'
`
}

function unavailableSh(): string {
  return `#!/bin/sh
printf '%s\n' 'kiko: ${UNAVAILABLE}' >&2
exit 1
`
}

function unavailablePs1(): string {
  return `throw 'kiko: ${UNAVAILABLE}'
`
}

function installScript(shell: boolean, origin: string, release: ComputerRelease | null): string {
  if (!release) return shell ? unavailableSh() : unavailablePs1()
  return shell ? installSh(origin, release) : installPs1(origin, release)
}

export async function installRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const shell = url.pathname === "/pc/install.sh"
  if (!shell && url.pathname !== "/pc/install.ps1") return null
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 })
  const release = await computerRelease(env)
  const body = installScript(shell, url.origin, release)
  return new Response(request.method === "HEAD" ? null : body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": CACHE },
  })
}
