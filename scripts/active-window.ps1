# Mochi 场景感知：常驻读取前台窗口的进程名 + 标题
# 输出：每 1.5 秒一行 JSON，形如 {"process":"Code","title":"main.js - Visual Studio Code"}
# 只读取进程名与窗口标题，不做任何持久化 / 联网

$ErrorActionPreference = 'SilentlyContinue'

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { $OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

if (-not ('MochiFg' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public class MochiFg {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    public static string ProcessName() {
        IntPtr h = GetForegroundWindow();
        int procId;
        GetWindowThreadProcessId(h, out procId);
        try { return System.Diagnostics.Process.GetProcessById(procId).ProcessName; }
        catch { return ""; }
    }

    public static string Title() {
        IntPtr h = GetForegroundWindow();
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(h, sb, 512);
        return sb.ToString();
    }
}
'@
}

while ($true) {
    $proc = ''
    $title = ''
    try { $proc = [MochiFg]::ProcessName() } catch {}
    try { $title = [MochiFg]::Title() } catch {}

    $obj = [ordered]@{
        process = $proc
        title   = $title
    } | ConvertTo-Json -Compress

    Write-Output $obj
    Start-Sleep -Milliseconds 1500
}
