import { COMPUTER_REPO, COMPUTER_SUMS_FILE, computerAssetBase, computerSums } from "@kiko/computer/install"
import { parseManifest, verifyRelease } from "@kiko/durable/release"
import type { Env } from "../index"
import { updateConfig } from "../lib/release-config"
import { BACKEND } from "../lib/version"

type DaemonRelease = { version: string; base: string; sums: string }

const CACHE = "public, max-age=300"

async function pinnedRelease(env: Env): Promise<DaemonRelease | null> {
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

async function daemonRelease(env: Env): Promise<DaemonRelease> {
  const pinned = await pinnedRelease(env)
  if (pinned) return pinned
  return { version: BACKEND.version, base: computerAssetBase(COMPUTER_REPO, BACKEND.version), sums: "" }
}

function installSh(origin: string, release: DaemonRelease): string {
  return `#!/bin/sh
set -eu

origin='${origin}'
version='${release.version}'
base='${release.base}'
sums='${release.sums}'

say() { printf '%s\\n' "$*"; }
die() { printf 'kiko: %s\\n' "$*" >&2; exit 1; }

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die "curl or wget is needed to download kiko-computer"
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

install_ffmpeg() {
  if [ "$os" = darwin ]; then
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
}

pair=''
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
if [ -z "$pair" ]; then pair="\${KIKO_PAIR_URL:-}"; fi

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die "this script installs on macOS and Linux. On Windows use the install.ps1 one-liner from $origin" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) die "unsupported architecture $(uname -m)" ;;
esac
asset="kiko-computer-$os-$arch"

base="\${KIKO_PC_BASE:-$base}"
home="\${KIKO_COMPUTER_HOME:-$HOME/.kiko-computer}"
bin="$home/bin"
mkdir -p "$bin"

say "kiko: installing $asset $version from $base"
if [ -z "$sums" ]; then
  sums_file="$home/${COMPUTER_SUMS_FILE}"
  download "$base/${COMPUTER_SUMS_FILE}" "$sums_file" || die "could not download the checksums for $version"
  sums="$(cat "$sums_file")"
fi
want="$(checksum_of "$asset")"
[ -n "$want" ] || die "the release has no checksum for $asset"
tmp="$bin/.$asset.part"
rm -f "$tmp"
download "$base/$asset" "$tmp" || die "could not download $asset from $base"
got="$(hash_of "$tmp")"
if [ "$got" != "$want" ]; then
  rm -f "$tmp"
  die "checksum mismatch for $asset: expected $want, got $got. Nothing was installed"
fi
exe="$bin/kiko-computer"
chmod 0755 "$tmp"
mv "$tmp" "$exe"
say "kiko: installed $exe"
case ":$PATH:" in
  *":$bin:"*) ;;
  *) say "kiko: add $bin to PATH, for example: export PATH=$bin:\\$PATH" ;;
esac

if command -v ffmpeg >/dev/null 2>&1; then
  say "kiko: ffmpeg found"
elif [ "$with_ffmpeg" = 1 ]; then
  if ! install_ffmpeg; then
    say "kiko: ffmpeg could not be installed automatically. Get it from https://ffmpeg.org/download.html"
  fi
else
  say "kiko: ffmpeg is missing. Live view needs it. Install it with:"
  say "  macOS: brew install ffmpeg"
  say "  Debian or Ubuntu: sudo apt-get install -y ffmpeg"
  say "  Fedora: sudo dnf install -y ffmpeg"
  say "  Arch: sudo pacman -S ffmpeg"
  say "  Alpine: sudo apk add ffmpeg"
  say "  or run this script again with --with-ffmpeg"
fi

say "kiko: desktop control needs cua-driver. Install it with:"
say '  /bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"'
say "kiko: shell and files work without it."

if [ -n "$pair" ]; then
  if [ -n "$pair_name" ]; then
    "$exe" pair "$pair" --name "$pair_name"
  else
    "$exe" pair "$pair"
  fi
  "$exe" service install
  say "kiko: paired this machine and installed the background service"
else
  say "kiko: no pair link yet. Open $origin in a browser, add this computer, then run:"
  say "  $exe pair '<pair-url>'"
  say "  $exe service install"
fi

say "kiko: done. $exe doctor checks this machine."
`
}

function installPs1(origin: string, release: DaemonRelease): string {
  return `param(
  [Parameter(Position = 0)][string]$PairUrl = $env:KIKO_PAIR_URL,
  [string]$Name = '',
  [switch]$WithFfmpeg
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$origin = '${origin}'
$version = '${release.version}'
$base = '${release.base}'
$sums = @'
${release.sums}'@

function Say([string]$Text) { Write-Host "kiko: $Text" }

if ($env:KIKO_PC_BASE) { $base = $env:KIKO_PC_BASE }
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { Say 'Windows on ARM runs the x64 build under emulation' }

$asset = 'kiko-computer-windows-x64.exe'
$local = $env:LOCALAPPDATA
if (-not $local) { $local = Join-Path $env:USERPROFILE 'AppData\\Local' }
$dir = Join-Path $local 'kiko-computer'
$bin = Join-Path $dir 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$exe = Join-Path $bin 'kiko-computer.exe'
$tmp = Join-Path $bin '.kiko-computer.part'

if (-not $sums) {
  $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/${COMPUTER_SUMS_FILE}").Content
}
$want = ''
foreach ($line in ($sums -split '\\r?\\n')) {
  $parts = $line.Trim() -split '\\s+'
  if ($parts.Length -ge 2) {
    $candidate = $parts[1] -replace '^\\*', ''
    if ($candidate -eq $asset) { $want = $parts[0].ToLower(); break }
  }
}
if (-not $want) { throw "kiko: the release has no checksum for $asset" }

Say "installing $asset $version from $base"
Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $tmp
$got = (Get-FileHash -Algorithm SHA256 -Path $tmp).Hash.ToLower()
if ($got -ne $want) {
  Remove-Item -Force $tmp
  throw "kiko: checksum mismatch for $asset. Nothing was installed"
}
Move-Item -Force $tmp $exe
Say "installed $exe"
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$bin*") { Say "add $bin to your PATH" }

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

Say 'desktop control needs cua-driver. Install it as described at https://cua.ai/docs'
Say 'shell and files work without it.'

if ($PairUrl) {
  if ($Name) {
    & $exe pair $PairUrl --name $Name
  } else {
    & $exe pair $PairUrl
  }
  if ($LASTEXITCODE -ne 0) { throw 'kiko: pairing failed' }
  & $exe service install
  if ($LASTEXITCODE -ne 0) { throw 'kiko: the background service could not be installed' }
  Say 'paired this machine and installed the background service'
} else {
  Say "no pair link yet. Open $origin in a browser, add this computer, then run:"
  Write-Host ('  "' + $exe + '" pair "<pair-url>"')
  Write-Host ('  "' + $exe + '" service install')
}

Say "done. $exe doctor checks this machine."
`
}

export async function installRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const shell = url.pathname === "/pc/install.sh"
  if (!shell && url.pathname !== "/pc/install.ps1") return null
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 })
  const release = await daemonRelease(env)
  const body = shell ? installSh(url.origin, release) : installPs1(url.origin, release)
  return new Response(request.method === "HEAD" ? null : body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": CACHE },
  })
}
