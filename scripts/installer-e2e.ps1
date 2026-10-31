param(
  [Parameter(Mandatory = $true)][string]$Assets,
  [Parameter(Mandatory = $true)][int]$Port
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$site = Join-Path $env:RUNNER_TEMP 'kiko-site'
$origin = "http://127.0.0.1:$Port"
$pair = "$origin/pc#e2e"
$local = $env:LOCALAPPDATA
$app = Join-Path $local 'kiko'
$old = Join-Path $local 'kiko-computer'
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

function Fail([string]$Text) {
  Write-Host "installer e2e: $Text"
  Get-Content (Join-Path $env:APPDATA 'kiko\kiko.log') -ErrorAction SilentlyContinue | Select-Object -Last 40
  Get-Content (Join-Path $env:APPDATA 'kiko-computer\daemon.log') -ErrorAction SilentlyContinue | Select-Object -Last 40
  exit 1
}

function WaitFor([scriptblock]$Ready, [string]$What) {
  for ($i = 0; $i -lt 150; $i++) {
    if (& $Ready) { return }
    Start-Sleep -Milliseconds 200
  }
  Fail "timed out waiting for $What"
}

New-Item -ItemType Directory -Force -Path (Join-Path $old 'bin') | Out-Null
Set-Content -Path (Join-Path $old 'bin\kiko-computer.exe') -Value 'old'
Set-ItemProperty -Path $run -Name 'kiko-computer' -Value ('"' + (Join-Path $old 'bin\kiko-computer.exe') + '"')
New-Item -ItemType Directory -Force -Path (Join-Path $env:APPDATA 'kiko-computer') | Out-Null
Set-Content -Path (Join-Path $env:APPDATA 'kiko-computer\keep-me') -Value 'keep'

$server = Start-Process -FilePath 'bun' -PassThru -WindowStyle Hidden `
  -ArgumentList @("$root\scripts\installer-e2e.ts", 'serve', $Assets, $site, $Port)
try {
  WaitFor { (Invoke-WebRequest -UseBasicParsing -Uri "$origin/install.sh").StatusCode -eq 200 } 'the release site'

  Write-Host 'running the installer'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $site 'install.ps1') $pair
  if ($LASTEXITCODE -ne 0) { Fail "the installer exited with $LASTEXITCODE" }

  if (-not (Test-Path (Join-Path $app 'kiko.exe'))) { Fail 'no kiko.exe' }
  if (-not (Test-Path (Join-Path $app 'kiko-core.exe'))) { Fail 'no kiko-core.exe' }

  WaitFor { $null -ne (Get-Process -Name 'kiko' -ErrorAction SilentlyContinue) } 'kiko to run'
  $proc = Get-Process -Name 'kiko' | Select-Object -First 1
  WaitFor { $null -ne (Get-CimInstance Win32_Process -Filter "Name='kiko-core.exe'") } 'kiko-core to run'
  $core = Get-CimInstance Win32_Process -Filter "Name='kiko-core.exe'" | Select-Object -First 1
  if ($core.ParentProcessId -ne $proc.Id) {
    Fail "kiko-core ($($core.ProcessId)) is not a child of kiko ($($proc.Id)), its parent is $($core.ParentProcessId)"
  }
  Write-Host "kiko ($($proc.Id)) is running kiko-core ($($core.ProcessId))"

  bun "$root\scripts\installer-e2e.ts" status '\\.\pipe\kiko-driver'
  if ($LASTEXITCODE -ne 0) { Fail 'the driver pipe did not answer status' }

  $value = (Get-ItemProperty -Path $run -Name 'kiko').kiko
  if ($value -notmatch 'kiko\.exe') { Fail "the Run key points at $value" }
  if (Get-ItemProperty -Path $run -Name 'kiko-computer' -ErrorAction SilentlyContinue) {
    Fail 'the old kiko-computer Run value is still there'
  }
  if (Test-Path $old) { Fail 'the old install directory is still there' }
  if (-not (Test-Path (Join-Path $env:APPDATA 'kiko-computer\keep-me'))) { Fail 'the old config directory was deleted' }
  Write-Host 'the Run key, the migration and the kept config directory are right'

  Write-Host 'running the installer again'
  $again = (& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $site 'install.ps1') 2>&1 | Out-String)
  if ($again -notmatch 'is already installed') { Fail "a rerun did not skip the download: $again" }
  if ((Get-Process -Name 'kiko').Id -ne $proc.Id) { Fail 'a rerun restarted the app' }

  Write-Host 'installing a newer version over the running app'
  $next = (& bun "$root\scripts\installer-e2e.ts" version) + '-e2e'
  bun "$root\scripts\installer-e2e.ts" write $Assets $site $Port $next
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $site 'install.ps1')
  if ($LASTEXITCODE -ne 0) { Fail "the update installer exited with $LASTEXITCODE" }
  $old = $proc.Id
  $oldCore = $core.ProcessId
  WaitFor { $null -eq (Get-Process -Id $old -ErrorAction SilentlyContinue) } 'the old kiko to quit'
  WaitFor { $null -eq (Get-Process -Id $oldCore -ErrorAction SilentlyContinue) } 'the old kiko-core to quit'
  WaitFor { @(Get-Process -Name 'kiko' -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $old }).Count -gt 0 } 'the updated kiko to start'
  $proc = Get-Process -Name 'kiko' | Where-Object { $_.Id -ne $old } | Select-Object -First 1
  WaitFor {
    $null -ne (Get-CimInstance Win32_Process -Filter "Name='kiko-core.exe'" | Where-Object { $_.ParentProcessId -eq $proc.Id })
  } 'the updated kiko-core to run'
  bun "$root\scripts\installer-e2e.ts" status '\\.\pipe\kiko-driver'
  if ($LASTEXITCODE -ne 0) { Fail 'the driver pipe did not answer status after the update' }
  if ((Get-Content (Join-Path $app 'VERSION') -Raw).Trim() -ne $next) { Fail 'the update did not write the new version' }
  Write-Host 'installer e2e passed'
} finally {
  & (Join-Path $app 'kiko.exe') --quit
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $site -ErrorAction SilentlyContinue
}
