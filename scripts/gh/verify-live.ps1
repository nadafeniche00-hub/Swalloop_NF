# Opens a saved template canvas in the real Grasshopper editor (Rhino 8), lets Grasshopper's own
# solver run, and writes what the components solved to next to the golden values. Also saves a
# screenshot of the screen while the editor is open.
#
#   powershell -ExecutionPolicy Bypass -File scripts/gh/verify-live.ps1 [-Screenshot docs/gh-canvas-manhattan.png]
#
# Rhino must not already be running. Exit code 0 = Grasshopper's own solver matched the golden file.
param([string]$Screenshot = '', [int]$TimeoutSeconds = 420, [switch]$KeepRhino)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_rhino.ps1')
$script = Join-Path $PSScriptRoot 'verify_live.py'
$result = Join-Path $env:TEMP 'swalloop-gh-live.json'

Start-RhinoScript -ScriptPath $script -ResultFile $result -TimeoutSeconds $TimeoutSeconds

if ($Screenshot) {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
    $path = if ([System.IO.Path]::IsPathRooted($Screenshot)) { $Screenshot } else { Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')) $Screenshot }
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host "screenshot: $path"
}

$r = Get-Content $result -Raw | ConvertFrom-Json
$r | ConvertTo-Json -Depth 5
if (-not $KeepRhino) { Get-Process Rhino -ErrorAction SilentlyContinue | Stop-Process -Force }
if ($r.ok) { exit 0 } else { exit 1 }
