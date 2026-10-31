# Shared by the verify-*.ps1 launchers (dot-source it): start Rhino with a script and wait for the
# script's result file.
#
# Some plugins open a modal warning at start-up (Karamba3D's "compatibility problem" is one). While it
# is open Rhino's script runner never starts, so informational windows of the Rhino process whose
# title contains "compatibility problem" are closed while we wait. Nothing else is touched.

Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class RhinoStartupWindows {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  public static List<string> CloseMatching(uint pid, string text) {
    var closed = new List<string>();
    EnumWindows((h, p) => {
      uint x; GetWindowThreadProcessId(h, out x);
      if (x != pid || !IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (sb.ToString().IndexOf(text, StringComparison.OrdinalIgnoreCase) >= 0) { PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); closed.Add(sb.ToString()); }
      return true;
    }, IntPtr.Zero);
    return closed;
  }
}
"@

$script:RhinoExe = 'C:\Program Files\Rhino 8\System\Rhino.exe'

function Start-RhinoScript {
    param([string]$ScriptPath, [string]$ResultFile, [int]$TimeoutSeconds = 480)
    if (-not (Test-Path $script:RhinoExe)) { throw "Rhino 8 not found at $script:RhinoExe" }
    if (Get-Process Rhino -ErrorAction SilentlyContinue) { throw 'Rhino is already running. Close it first: a second start does not run the script.' }
    if (-not (Test-Path (Join-Path $env:APPDATA 'Grasshopper\Libraries\Swalloop\Swalloop.gha'))) {
        throw 'Swalloop.gha is not installed. Run dotnet/install-gha.ps1 first.'
    }
    if (Test-Path $ResultFile) { [System.IO.File]::Delete($ResultFile) }
    Start-Process $script:RhinoExe -ArgumentList '/nosplash', "/runscript=`"-_RunPythonScript $ScriptPath`"" | Out-Null
    $waited = 0
    while (-not (Test-Path $ResultFile) -and $waited -lt $TimeoutSeconds) {
        Start-Sleep -Seconds 3
        $waited += 3
        $live = Get-Process Rhino -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($live) {
            foreach ($t in [RhinoStartupWindows]::CloseMatching([uint32]$live.Id, 'compatibility problem')) {
                Write-Host "closed a start-up warning from another plugin: $t"
            }
        }
    }
    if (-not (Test-Path $ResultFile)) { throw "No result after $TimeoutSeconds s." }
}
