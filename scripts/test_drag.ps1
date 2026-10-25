# 真机拖拽实验：启动 Mochi → 用 SendInput 拖动宠物 → 读取配置里的 petPos 是否变化
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, IntPtr dwExtraInfo);
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
}
"@

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$tmp = Join-Path $env:TEMP ("mochi-drag-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$cfgPath = Join-Path $tmp "mochi-config.json"
$cfg = @{
  onboarded = $true; character = 'cat'; scene = @{ on = $false }; sound = $false;
  water = @{ on = $false }; stand = @{ on = $false }; pomodoro = @{ on = $false };
  layer = 'top'; petPos = @{ x = 700; y = 300 }
} | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($cfgPath, $cfg)

$env:ELECTRON_RUN_AS_NODE = $null
$env:MOCHI_NO_GPU = "1"
$exe = Join-Path $root "node_modules\electron\dist\electron.exe"
$p = Start-Process -FilePath $exe -ArgumentList ".", "--user-data-dir=$tmp" -WorkingDirectory $root -PassThru
Start-Sleep -Seconds 7

$before = (Get-Content $cfgPath -Raw | ConvertFrom-Json).petPos
"before: x=$($before.x) y=$($before.y)"

# 宠物窗口 360x440，宠物形象大致在窗口中下部
$cx = 700 + 180
$cy = 300 + 250
[MInput]::SetCursorPos($cx, $cy) | Out-Null
Start-Sleep -Milliseconds 400
[MInput]::mouse_event([MInput]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 200
for ($i = 1; $i -le 20; $i++) {
  [MInput]::SetCursorPos($cx - (6 * $i), $cy - (4 * $i)) | Out-Null
  Start-Sleep -Milliseconds 30
}
Start-Sleep -Milliseconds 200
[MInput]::mouse_event([MInput]::LEFTUP, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 1200

$after = (Get-Content $cfgPath -Raw | ConvertFrom-Json).petPos
"after : x=$($after.x) y=$($after.y)"
if ($before.x -ne $after.x -or $before.y -ne $after.y) { "RESULT: 可拖拽（位置已变化）" } else { "RESULT: 无法拖拽（位置未变）" }

Get-Process Mochi, electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
