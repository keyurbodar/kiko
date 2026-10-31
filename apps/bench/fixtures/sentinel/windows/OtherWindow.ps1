param(
  [int]$Seconds = 12
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class OtherWindowNative {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@

$form = New-Object System.Windows.Forms.Form
$form.Text = "Other window"
$form.Width = 360
$form.Height = 220
$form.StartPosition = "Manual"
$form.Left = 760
$form.Top = 260
$script:form = $form

$form.Show()
$form.Activate()
[OtherWindowNative]::SetForegroundWindow($form.Handle) | Out-Null

$steal = New-Object System.Windows.Forms.Timer
$steal.Interval = 500
$steal.Add_Tick({
  if ([OtherWindowNative]::GetForegroundWindow() -ne $script:form.Handle) {
    $script:form.Activate()
    [OtherWindowNative]::SetForegroundWindow($script:form.Handle) | Out-Null
  }
})
$steal.Start()

$close = New-Object System.Windows.Forms.Timer
$close.Interval = $Seconds * 1000
$script:close = $close
$close.Add_Tick({
  $script:close.Stop()
  $script:form.Close()
})
$close.Start()

[System.Windows.Forms.Application]::Run($form)
