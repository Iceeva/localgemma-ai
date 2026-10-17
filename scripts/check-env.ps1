# Verifie l'environnement Windows pour LocalGemma AI. Usage : .\scripts\check-env.ps1
$ErrorActionPreference = 'Continue'
$ok = $true
function Say($label, $good, $detail) {
  if ($good) { Write-Host "[OK]  $label $detail" -ForegroundColor Green }
  else { Write-Host "[KO]  $label $detail" -ForegroundColor Red; $script:ok = $false }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  $v = (& node -v).TrimStart('v')
  $major = [int]($v.Split('.')[0]); $minor = [int]($v.Split('.')[1])
  Say 'Node.js' (($major -gt 18) -or ($major -eq 18 -and $minor -ge 18)) "version $v (18.18 minimum, 20 ou 22 LTS recommande)"
} else { Say 'Node.js' $false 'introuvable : installez la version LTS depuis https://nodejs.org' }

$npm = Get-Command npm -ErrorAction SilentlyContinue
Say 'npm' ($null -ne $npm) ''

Say 'PowerShell (selecteurs de fichiers)' ($PSVersionTable.PSVersion.Major -ge 5) "version $($PSVersionTable.PSVersion)"
Say 'Dependances installees' (Test-Path (Join-Path $PSScriptRoot '..\node_modules')) '(lancez .\scripts\install.ps1 sinon)'

$port = 3000
$busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
Say "Port $port libre" ($null -eq $busy) '(port de l interface LocalGemma AI)'

$ram = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
Write-Host "[i]   Memoire vive totale : $ram Go (un modele GGUF doit tenir dans la RAM libre, avec son contexte)"

if ($ok) { Write-Host "`nEnvironnement pret." -ForegroundColor Green; exit 0 }
else { Write-Host "`nCorrigez les points KO ci-dessus." -ForegroundColor Yellow; exit 1 }
