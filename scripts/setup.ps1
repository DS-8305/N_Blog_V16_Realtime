param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $taskProjectRoot
try {
  & npm.cmd ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Node dependency installation failed.' }
  & $Python -m venv .venv
  if ($LASTEXITCODE -ne 0) { throw 'Python 3.10+ is required. Pass -Python with its executable path.' }
  & '.venv/Scripts/python.exe' -m pip install -r requirements.txt --disable-pip-version-check
  if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
  if (-not (Test-Path -LiteralPath 'nblog.config.json')) {
    Copy-Item -LiteralPath 'nblog.config.example.json' -Destination 'nblog.config.json'
  }
  Write-Output 'Setup complete. Set your blogId in nblog.config.json, then run scripts/login.ps1.'
} finally { Pop-Location }
