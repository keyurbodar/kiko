param(
  [Parameter(Mandatory = $true)][string]$Ready,
  [Parameter(Mandatory = $true)][string]$Out
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:outPath = $Out
$script:readyPath = $Ready

$form = New-Object System.Windows.Forms.Form
$form.Text = "kiko roundtrip"
$form.ClientSize = New-Object System.Drawing.Size(360, 80)
$form.StartPosition = "CenterScreen"
$form.TopMost = $true
$script:form = $form

$box = New-Object System.Windows.Forms.TextBox
$box.Name = "box"
$box.Width = 320
$box.Location = New-Object System.Drawing.Point(20, 24)
$form.Controls.Add($box)

$watchdog = New-Object System.Windows.Forms.Timer
$watchdog.Interval = 45000
$watchdog.Add_Tick({ $script:form.Close() })

$form.Add_Shown({
  $script:form.Activate()
  $box.Focus()
  $watchdog.Start()
  Start-Sleep -Milliseconds 250
  $at = $box.PointToScreen([System.Drawing.Point]::Empty)
  Set-Content -Path $script:readyPath -Value "$($at.X),$($at.Y),$($box.Width),$($box.Height)"
})

$box.Add_KeyDown({
  param($sender, $event)
  if ($event.KeyCode -eq [System.Windows.Forms.Keys]::F9) {
    Set-Content -Path $script:outPath -Value $sender.Text
    $script:form.Close()
  }
})

[System.Windows.Forms.Application]::Run($form)
