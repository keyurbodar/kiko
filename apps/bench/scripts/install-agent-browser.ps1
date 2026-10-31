$ErrorActionPreference = "Stop"

$version = "0.41.0"
$root = if ($env:KIKO_BENCH_TOOLS_DIR) { $env:KIKO_BENCH_TOOLS_DIR } else { Join-Path $HOME ".kiko-bench\tools" }
$dest = Join-Path $root "agent-browser-$version"
$asset = "agent-browser-win32-x64.exe"
$sha = "dee86b78071cbe7217f71ec1c9df6a50efa73cd44d64a18877bb36556fc8e270"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("agent-browser-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  $url = "https://github.com/vercel-labs/agent-browser/releases/download/v$version/$asset"
  $download = Join-Path $tmp $asset
  Invoke-WebRequest -Uri $url -OutFile $download
  $actual = (Get-FileHash -Algorithm SHA256 -Path $download).Hash.ToLower()
  if ($actual -ne $sha) {
    throw "install-agent-browser: sha256 mismatch for $asset`: expected $sha, got $actual"
  }
  $binary = Join-Path $dest "agent-browser.exe"
  Move-Item -Force -Path $download -Destination $binary
} finally {
  Remove-Item -Recurse -Force $tmp
}

& $binary --version | Out-Host
Write-Output $binary
