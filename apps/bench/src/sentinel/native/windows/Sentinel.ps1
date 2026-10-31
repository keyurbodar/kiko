param(
  [string]$Log,
  [string]$StopFile,
  [string]$MovePointer
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class KikoSentinelNative {
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const ushort VK_A = 0x41;

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct HARDWAREINPUT {
    public uint uMsg;
    public ushort wParamL;
    public ushort wParamH;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern IntPtr GetTopWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder name, int count);

  [DllImport("user32.dll")]
  public static extern int GetWindowLong(IntPtr hWnd, int index);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  public static bool SendKey() {
    INPUT down = new INPUT();
    down.type = 1;
    down.U.ki.wVk = VK_A;
    INPUT up = new INPUT();
    up.type = 1;
    up.U.ki.wVk = VK_A;
    up.U.ki.dwFlags = KEYEVENTF_KEYUP;
    INPUT[] inputs = new INPUT[] { down, up };
    return SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT))) == 2;
  }
}
"@

function Write-Event {
  param([string]$Event, [hashtable]$Extra = @{})
  if (-not $Log) { return }
  $line = @{ ev = $Event; t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  foreach ($key in $Extra.Keys) { $line[$key] = $Extra[$key] }
  [System.IO.File]::AppendAllText($Log, ($line | ConvertTo-Json -Compress -Depth 6) + "`n")
}

if ($MovePointer) {
  $parts = $MovePointer.Split(",")
  $position = [System.Windows.Forms.Cursor]::Position
  $x = $position.X + [int]$parts[0]
  $y = $position.Y + [int]$parts[1]
  if (-not [KikoSentinelNative]::SetCursorPos($x, $y)) {
    [Console]::Error.WriteLine("sentinel: SetCursorPos failed")
    exit 2
  }
  exit 0
}

if (-not $Log) {
  [Console]::Error.WriteLine("sentinel: -Log PATH is required")
  exit 2
}

function Get-Above {
  $names = New-Object System.Collections.Generic.List[string]
  $handle = [KikoSentinelNative]::GetTopWindow([IntPtr]::Zero)
  while ($handle -ne [IntPtr]::Zero -and $handle -ne $script:form.Handle) {
    if ([KikoSentinelNative]::IsWindowVisible($handle)) {
      [uint32]$owner = 0
      [KikoSentinelNative]::GetWindowThreadProcessId($handle, [ref]$owner) | Out-Null
      $style = [KikoSentinelNative]::GetWindowLong($handle, -20)
      $rect = New-Object KikoSentinelNative+RECT
      [KikoSentinelNative]::GetWindowRect($handle, [ref]$rect) | Out-Null
      $buffer = New-Object System.Text.StringBuilder 256
      [KikoSentinelNative]::GetClassName($handle, $buffer, 256) | Out-Null
      $class = $buffer.ToString()
      $skip = $owner -eq $PID -or
        ($style -band 0x00000008) -ne 0 -or
        ($style -band 0x00000080) -ne 0 -or
        $class -in @("Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW")
      $size = ($rect.Right - $rect.Left) -gt 1 -and ($rect.Bottom - $rect.Top) -gt 1
      if (-not $skip -and $size) { $names.Add($class) }
    }
    $handle = [KikoSentinelNative]::GetWindow([IntPtr]$handle, 2)
  }
  return $names.ToArray()
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "User activity"
$form.Width = 420
$form.Height = 240
$form.StartPosition = "Manual"
$form.Left = 420
$form.Top = 340
$form.KeyPreview = $true

$box = New-Object System.Windows.Forms.TextBox
$box.Left = 20
$box.Top = 40
$box.Width = 360
$form.Controls.Add($box)

$script:form = $form
$script:keysReceived = 0
$script:ticks = 0
$script:pending = $null
$script:stopping = $false

$form.Add_KeyDown({ $script:keysReceived++ })

function Resolve-Pending {
  if ($null -eq $script:pending) { return }
  $pending = $script:pending
  $script:pending = $null
  Write-Event "tick" @{ n = $pending.n; received = ($script:keysReceived -gt $pending.before) }
}

$sampler = New-Object System.Windows.Forms.Timer
$sampler.Interval = 100
$sampler.Add_Tick({
  if ($StopFile -and (Test-Path $StopFile)) {
    if (-not $script:stopping) {
      $script:stopping = $true
      $script:sampler.Stop()
      $script:ticker.Stop()
      $drain = New-Object System.Windows.Forms.Timer
      $drain.Interval = 500
      $script:drain = $drain
      $drain.Add_Tick({
        $script:drain.Stop()
        Resolve-Pending
        Write-Event "exit"
        $script:form.Close()
      })
      $drain.Start()
    }
    return
  }
  $front = [KikoSentinelNative]::GetForegroundWindow()
  $isSelf = $front -eq $script:form.Handle
  $position = [System.Windows.Forms.Cursor]::Position
  try {
    $above = @(Get-Above)
  } catch {
    $script:sampler.Stop()
    $script:ticker.Stop()
    Write-Event "error" @{ message = $_.Exception.Message }
    return
  }
  Write-Event "sample" @{
    front = $(if ($isSelf) { "self" } else { "other" })
    key = $isSelf
    above = $above
    pointer = @($position.X, $position.Y)
  }
})

$ticker = New-Object System.Windows.Forms.Timer
$ticker.Interval = 1000
$ticker.Add_Tick({
  Resolve-Pending
  $script:pending = @{ n = $script:ticks; before = $script:keysReceived }
  $script:ticks++
  if (-not [KikoSentinelNative]::SendKey()) {
    Write-Event "error" @{ message = "SendInput failed" }
    $script:form.Close()
  }
})

$script:sampler = $sampler
$script:ticker = $ticker
$script:attempts = 0

$verify = New-Object System.Windows.Forms.Timer
$verify.Interval = 500
$verify.Add_Tick({
  $script:attempts++
  if ([KikoSentinelNative]::GetForegroundWindow() -eq $script:form.Handle) {
    $verify.Stop()
    Write-Event "ready" @{ pid = $PID }
    $script:sampler.Start()
    $script:ticker.Start()
  } elseif ($script:attempts -ge 4) {
    $verify.Stop()
    Write-Event "error" @{ message = "window did not take the foreground" }
    $script:form.Close()
  } else {
    $script:form.Activate()
    [KikoSentinelNative]::SetForegroundWindow($script:form.Handle) | Out-Null
  }
})

$form.Add_Shown({
  $script:form.Activate()
  [KikoSentinelNative]::SetForegroundWindow($script:form.Handle) | Out-Null
  $box.Focus() | Out-Null
  $verify.Start()
})

[System.Windows.Forms.Application]::Run($form)
