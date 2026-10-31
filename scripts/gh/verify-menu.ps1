# Drives the Swalloop menu in Grasshopper's menu bar like a user (click "Open the ... template"),
# lets Grasshopper's own solver run, and compares the new document with the golden file.
#
#   powershell -ExecutionPolicy Bypass -File scripts/gh/verify-menu.ps1 [-KeepRhino]
#
# Rhino must not already be running. Exit code 0 = the menu is there and its featured item opens a
# canvas that solves to the golden numbers.
param([int]$TimeoutSeconds = 420, [switch]$KeepRhino)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_rhino.ps1')
$script = Join-Path $PSScriptRoot 'verify_menu.py'
$result = Join-Path $env:TEMP 'swalloop-gh-menu.json'

Start-RhinoScript -ScriptPath $script -ResultFile $result -TimeoutSeconds $TimeoutSeconds

$r = Get-Content $result -Raw | ConvertFrom-Json
$r | ConvertTo-Json -Depth 5
if (-not $KeepRhino) { Get-Process Rhino -ErrorAction SilentlyContinue | Stop-Process -Force }
if ($r.ok) { exit 0 } else { exit 1 }
