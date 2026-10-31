$ErrorActionPreference = "Stop"

$version = "1.0.2"
$root = if ($env:KIKO_BENCH_TOOLS_DIR) { $env:KIKO_BENCH_TOOLS_DIR } else { Join-Path $HOME ".kiko-bench\tools" }
$dest = Join-Path $root "agent-desktop-$version"
$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture

if ($arch -eq [System.Runtime.InteropServices.Architecture]::Arm64) {
  $asset = "agent-desktop-v$version-aarch64-pc-windows-msvc.tar.gz"
  $sha = "a0ecd6e17e60a0bcfbb45533a72f2d3a7a73508769588273ef08b0477d2b9687"
} else {
  $asset = "agent-desktop-v$version-x86_64-pc-windows-msvc.tar.gz"
  $sha = "2186c76e7df197c0e67365e45d36d869f74714c56bb8a73817e2a66f3e18e222"
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("agent-desktop-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  $url = "https://github.com/vercel-labs/agent-desktop/releases/download/v$version/$asset"
  $archive = Join-Path $tmp $asset
  Invoke-WebRequest -Uri $url -OutFile $archive
  $actual = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLower()
  if ($actual -ne $sha) {
    throw "install-agent-desktop: sha256 mismatch for $asset`: expected $sha, got $actual"
  }
  tar -xzf $archive -C $dest
} finally {
  Remove-Item -Recurse -Force $tmp
}

$binary = Join-Path $dest "agent-desktop.exe"
& $binary version | Out-Host
Write-Output $binary
