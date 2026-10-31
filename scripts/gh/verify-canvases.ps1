# Builds every template as a Grasshopper canvas inside Rhino 8, solves it, compares the outputs of
# every node with the golden files from the JavaScript engine, and saves each canvas as
# templates/grasshopper/<name>.gh.
#
#   powershell -ExecutionPolicy Bypass -File scripts/gh/verify-canvases.ps1
#
# Rhino must not already be running. Start-up warnings from other plugins are closed while waiting
# (see _rhino.ps1). Exit code 0 = every canvas, and every reopened .gh file, matched.
param([int]$TimeoutSeconds = 480, [switch]$KeepRhino)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_rhino.ps1')
$script = Join-Path $PSScriptRoot 'verify_canvases.py'
$result = Join-Path $env:TEMP 'swalloop-gh-canvases.json'

Start-RhinoScript -ScriptPath $script -ResultFile $result -TimeoutSeconds $TimeoutSeconds

$r = Get-Content $result -Raw | ConvertFrom-Json
$r.steps | ForEach-Object { Write-Host $_ }
if ($r.error) { Write-Host $r.error -ForegroundColor Red }
$bad = @($r.templates | Where-Object { -not $_.ok })
foreach ($t in $bad) { Write-Host ("  {0}:" -f $t.template) -ForegroundColor Red; $t.problems | ForEach-Object { Write-Host ("     " + $_.ToString().Substring(0, [Math]::Min(220, $_.ToString().Length))) } }
if (-not $KeepRhino) { Get-Process Rhino -ErrorAction SilentlyContinue | Stop-Process -Force }
if ($r.ok) { Write-Host "All $(@($r.templates).Count) canvases match the golden files." -ForegroundColor Green; exit 0 }
exit 1
