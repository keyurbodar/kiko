$ErrorActionPreference = "Stop"

$version = "0.38.0"
$root = if ($env:KIKO_BENCH_TOOLS_DIR) { $env:KIKO_BENCH_TOOLS_DIR } else { Join-Path $HOME ".kiko-bench\tools" }
$dest = Join-Path $root "cua-driver-$version"
$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture

if ($arch -eq [System.Runtime.InteropServices.Architecture]::Arm64) {
  $asset = "cua-driver-rs-$version-windows-arm64-binary.zip"
  $sha = "c442872360cbb819e288b9f30daa7e3d2693d5945495d1400bcd90af5bd16402"
} else {
  $asset = "cua-driver-rs-$version-windows-x86_64-binary.zip"
  $sha = "5edaa74d0afa1b55a9668dbc4f32736507bd2bd4d75b18ca1dc8881bb12402b5"
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("cua-driver-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  $url = "https://github.com/trycua/cua/releases/download/cua-driver-rs-v$version/$asset"
  $archive = Join-Path $tmp $asset
  Invoke-WebRequest -Uri $url -OutFile $archive
  $actual = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLower()
  if ($actual -ne $sha) {
    throw "install-cua-driver: sha256 mismatch for $asset`: expected $sha, got $actual"
  }
  Expand-Archive -Path $archive -DestinationPath $dest -Force
} finally {
  Remove-Item -Recurse -Force $tmp
}

$binary = Join-Path $dest "cua-driver.exe"
& $binary --version | Out-Host
Write-Output $binary
