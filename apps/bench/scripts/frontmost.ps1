Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class KikoForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@

$handle = [KikoForeground]::GetForegroundWindow()
$builder = New-Object System.Text.StringBuilder 512
[void][KikoForeground]::GetWindowText($handle, $builder, 512)
Write-Output $builder.ToString()
