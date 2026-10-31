# Starts Rhino 8 with scripts/gh/verify_swalloop.py, which loads Grasshopper, runs the Swalloop
# Template component on every tower template and compares the numbers with the golden files.
#
#   powershell -ExecutionPolicy Bypass -File scripts/gh/verify.ps1
#
# Rhino must not already be running (a second start does not run the script). It is left open
# afterwards, with the Grasshopper editor showing. Exit code 0 = every template matched.
# Start-up warnings from other plugins are closed while waiting (see _rhino.ps1).
param([int]$TimeoutSeconds = 420)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_rhino.ps1')
$script = Join-Path $PSScriptRoot 'verify_swalloop.py'
$result = Join-Path $env:TEMP 'swalloop-gh-verify.json'

Start-RhinoScript -ScriptPath $script -ResultFile $result -TimeoutSeconds $TimeoutSeconds

$r = Get-Content $result -Raw | ConvertFrom-Json
$r.steps | ForEach-Object { Write-Host $_ }
if ($r.error) { Write-Host $r.error -ForegroundColor Red }
if ($r.ok) { Write-Host 'Grasshopper matches the golden files.' -ForegroundColor Green; exit 0 }
Write-Host 'Mismatch or error; see the result file:' $result -ForegroundColor Red
exit 1
