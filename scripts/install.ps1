# Installe les dependances et construit l'application. Usage : .\scripts\install.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

& (Join-Path $PSScriptRoot 'check-env.ps1')
if ($LASTEXITCODE -ne 0 -and -not (Get-Command node -ErrorAction SilentlyContinue)) { exit 1 }

Write-Host "`nInstallation des dependances (npm ci)..." -ForegroundColor Cyan
if (Test-Path 'package-lock.json') { npm ci } else { npm install }
if ($LASTEXITCODE -ne 0) { throw 'npm a echoue.' }

Write-Host "`nConstruction de l'application..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw 'La construction a echoue.' }

Write-Host "`nInstallation terminee. Lancez : .\scripts\start.ps1" -ForegroundColor Green
