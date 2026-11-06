$ErrorActionPreference = 'Stop'
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $taskProjectRoot
try {
  if (-not (Test-Path -LiteralPath 'dist/cli.js')) { throw 'Run scripts/setup.ps1 first.' }
  & node dist/cli.js browser:login
  if ($LASTEXITCODE -ne 0) { throw 'Could not open the dedicated Chrome session.' }
} finally { Pop-Location }
