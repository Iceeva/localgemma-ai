# Demarre LocalGemma AI et ouvre le navigateur. Usage : .\scripts\start.ps1 [-Port 3000] [-NoBrowser]
param([int]$Port = 3000, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js est introuvable. Installez-le depuis https://nodejs.org puis relancez.' }
if (-not (Test-Path 'node_modules')) { throw 'Dependances absentes. Lancez d abord .\scripts\install.ps1' }
if (-not (Test-Path '.next\BUILD_ID')) {
  Write-Host 'Premiere construction de l application...' -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'La construction a echoue.' }
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "Le port $Port est deja utilise. Lancez .\scripts\stop.ps1 ou choisissez un autre port : .\scripts\start.ps1 -Port 3001"
}

$url = "http://localhost:$Port"
Write-Host "LocalGemma AI : $url   (Ctrl+C pour quitter ; le modele actif sera arrete)" -ForegroundColor Green
if (-not $NoBrowser) { Start-Job { Start-Sleep 4; Start-Process $using:url } | Out-Null }

# Ecoute uniquement sur 127.0.0.1 : l'application n'est pas accessible depuis le reseau.
& node .\node_modules\next\dist\bin\next start -H 127.0.0.1 -p $Port
