$ErrorActionPreference = "Stop"

$target = $args[0]
$out = $args[1]
if (-not $target -or -not $out) {
  throw "usage: fetch-cua-driver.ps1 <windows-x64|windows-arm64> <out-dir>"
}

$config = Get-Content (Join-Path $PSScriptRoot "..\cua-driver.json") -Raw | ConvertFrom-Json
$entry = $config.assets.$target
if (-not $entry) {
  throw "fetch-cua-driver: no pinned cua-driver asset for $target"
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("cua-driver-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  $url = "https://github.com/trycua/cua/releases/download/cua-driver-rs-v$($config.version)/$($entry.asset)"
  $archive = Join-Path $tmp $entry.asset
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive
  $actual = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLower()
  if ($actual -ne $entry.sha256) {
    throw "fetch-cua-driver: sha256 mismatch for $($entry.asset): expected $($entry.sha256), got $actual"
  }
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  Expand-Archive -Path $archive -DestinationPath $out -Force
} finally {
  Remove-Item -Recurse -Force $tmp
}

$binary = Join-Path $out "cua-driver.exe"
& $binary --version | Out-Host
Write-Output $binary
