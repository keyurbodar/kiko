param([Parameter(Mandatory = $true)][string]$Title)

$shell = New-Object -ComObject WScript.Shell
if (-not $shell.AppActivate($Title)) {
  Write-Error "no window matching $Title"
  exit 1
}
