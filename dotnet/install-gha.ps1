# Builds the Grasshopper plugin and installs it for the current user.
#
#   powershell -ExecutionPolicy Bypass -File dotnet/install-gha.ps1            # Rhino 8 on .NET Framework (default)
#   powershell -ExecutionPolicy Bypass -File dotnet/install-gha.ps1 -Framework net7.0-windows   # Rhino 8 in "netcore" mode
#
# It copies Swalloop.gha and Swalloop.Core.dll to %APPDATA%\Grasshopper\Libraries\Swalloop. Restart
# Rhino (Grasshopper reads its libraries at start-up). Close Rhino first if it is running: a loaded
# .gha is locked by the process.
param(
    [ValidateSet('net48', 'net7.0-windows')]
    [string]$Framework = 'net48'
)

$ErrorActionPreference = 'Stop'
$proj = Join-Path $PSScriptRoot 'Swalloop.Grasshopper\Swalloop.Grasshopper.csproj'

if (Get-Process Rhino -ErrorAction SilentlyContinue) {
    Write-Warning 'Rhino is running; a loaded Swalloop.gha is locked and cannot be replaced. Close Rhino and run this again.'
}

dotnet build $proj -c Release -f $Framework -nologo -v q
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }

$out = Join-Path $PSScriptRoot "Swalloop.Grasshopper\bin\Release\$Framework"
$dst = Join-Path $env:APPDATA 'Grasshopper\Libraries\Swalloop'
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item (Join-Path $out 'Swalloop.gha'), (Join-Path $out 'Swalloop.Core.dll') -Destination $dst -Force

Write-Host "Installed Swalloop ($Framework) to $dst"
Write-Host 'Restart Rhino, then look for the Swalloop tab in Grasshopper.'
