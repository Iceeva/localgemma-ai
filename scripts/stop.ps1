# Arrete LocalGemma AI (et seulement lui). Usage : .\scripts\stop.ps1 [-Port 3000]
param([int]$Port = 3000)
$ErrorActionPreference = 'Continue'

# 1) Serveur web LocalGemma AI : uniquement le processus node qui ecoute sur le port choisi.
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  $p = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq 'node') {
    Stop-Process -Id $p.Id -Force
    Write-Host "Interface arretee (PID $($p.Id))." -ForegroundColor Green
  } else { Write-Host "Le port $Port est utilise par '$($p.ProcessName)', pas par node : rien n'a ete arrete." -ForegroundColor Yellow }
} else { Write-Host "Aucune interface en ecoute sur le port $Port." }

# 2) llama-server lance par l'application : uniquement le PID note dans server.pid.json, apres verification du nom.
$dataDir = if ($env:LOCALGEMMA_DATA_DIR) { $env:LOCALGEMMA_DATA_DIR } else { Join-Path $env:APPDATA 'LocalGemmaAI' }
$pidFile = Join-Path $dataDir 'server.pid.json'
if (Test-Path $pidFile) {
  $info = Get-Content $pidFile -Raw | ConvertFrom-Json
  $proc = Get-Process -Id $info.pid -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -like 'llama-server*') {
    Stop-Process -Id $proc.Id
    Start-Sleep -Seconds 2
    if (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) { Stop-Process -Id $proc.Id -Force }
    Write-Host "llama-server arrete (PID $($proc.Id))." -ForegroundColor Green
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
# Les autres processus llama-server de votre ordinateur ne sont jamais touches.
