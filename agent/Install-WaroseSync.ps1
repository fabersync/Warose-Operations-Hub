<#
  Instalează agentul Warose Sync ca sarcină programată Windows care rulează:
    - la pornirea calculatorului și apoi la fiecare 5 minute,
    - sub contul SYSTEM (nu depinde de utilizatorul autentificat și nici de Claude Code),
    - ascuns, fără ferestre.

  Rulați din PowerShell deschis 'Ca administrator', din folderul agent\:
    powershell -ExecutionPolicy Bypass -File .\Install-WaroseSync.ps1 `
      -ServerUrl "https://hub.warose.ro" -Token "wrs_..." `
      -Publine "D:\Exporturi Publine" `
      [-EFactura "C:\SAGA C.3.0\e-Factura\DAVID_WAROSE_SRL" -EFacturaSince "2026-10-01"]

  Ce modifică pe calculator (și nimic altceva):
    - creează C:\ProgramData\WaroseSync (scriptul, configurația, coada, logurile), accesibil doar SYSTEM și Administratorilor;
    - înregistrează sursa 'WaroseSync' în jurnalul de evenimente Windows (Application);
    - creează sarcina programată 'Warose Sync'.
  Dezinstalare: Uninstall-WaroseSync.ps1
#>
param(
  [Parameter(Mandatory = $true)][string]$ServerUrl,
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Publine,
  [string]$EFactura,
  [string]$EFacturaSince,
  [string]$InstallDir = "C:\ProgramData\WaroseSync"
)
$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Rulați PowerShell 'Ca administrator'." }
if (-not $Publine -and -not $EFactura) { throw "Indicați cel puțin o sursă: -Publine și/sau -EFactura." }
if ($Token -notmatch '^wrs_[A-Za-z0-9_-]{20,}$') { throw "Cheia agentului nu are formatul așteptat (wrs_...). Copiați-o din aplicație: Setări → Agenți." }
$uri = [Uri]$ServerUrl
if ($uri.Scheme -ne "https" -and @("localhost", "127.0.0.1") -notcontains $uri.Host) { throw "ServerUrl trebuie să înceapă cu https://" }
foreach ($p in @($Publine, $EFactura)) { if ($p -and -not (Test-Path -LiteralPath $p)) { throw "Folderul nu există: $p" } }
if ($EFacturaSince -and $EFacturaSince -notmatch '^\d{4}-\d{2}-\d{2}$') { throw "-EFacturaSince trebuie să fie de forma AAAA-LL-ZZ." }

Write-Host "1/6 Copiez agentul în $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "WaroseSync.ps1") -Destination $InstallDir -Force

Write-Host "2/6 Scriu configurația (cheia este criptată cu DPAPI, legată de acest calculator)"
Add-Type -AssemblyName System.Security
$protected = [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($Token), $null, [Security.Cryptography.DataProtectionScope]::LocalMachine))
$sources = @()
if ($Publine) { $sources += [ordered]@{ Type = "publine"; Folder = $Publine; Patterns = @("*.xls", "*.xlsx", "*.csv"); Recursive = $false } }
if ($EFactura) {
  $since = $EFacturaSince; if (-not $since) { $since = (Get-Date -Day 1).ToString("yyyy-MM-dd") }
  $sources += [ordered]@{ Type = "efactura"; Folder = $EFactura; SubfolderFilter = "FacturiPrimite"; SinceDate = $since }
}
$cfg = [ordered]@{ ServerUrl = $ServerUrl.TrimEnd("/"); TokenProtected = $protected; Sources = $sources; MinFileAgeSeconds = 60; KeepSentDays = 90; LogRetentionDays = 30 }
($cfg | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath (Join-Path $InstallDir "config.json") -Encoding UTF8

Write-Host "3/6 Restricționez accesul la folder (SYSTEM și Administratori)"
& icacls $InstallDir /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null

Write-Host "4/6 Înregistrez sursa în jurnalul de evenimente Windows"
if (-not [Diagnostics.EventLog]::SourceExists("WaroseSync")) { New-EventLog -LogName Application -Source "WaroseSync" }

Write-Host "5/6 Creez sarcina programată 'Warose Sync' (la pornire + la fiecare 5 minute, cont SYSTEM)"
$script = Join-Path $InstallDir "WaroseSync.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" -WorkingDirectory $InstallDir
$every5 = (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)).Repetition
$atStartup = New-ScheduledTaskTrigger -AtStartup
$atStartup.Delay = "PT2M"
$atStartup.Repetition = $every5
$now = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "Warose Sync" -Action $action -Trigger @($atStartup, $now) -Principal $principal -Settings $settings `
  -Description "Warose Operations Hub: trimite exporturile Publine și facturile e-Factura (doar citire) către aplicația centrală." -Force | Out-Null

Write-Host "6/6 Verificare (fără a trimite nimic):"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Test
Write-Host ""
Write-Host "Instalare încheiată. Prima rulare automată: în cel mult 1 minut."
Write-Host "Loguri: $InstallDir\logs  ·  Stare: $InstallDir\status.json  ·  Evenimente: Event Viewer → Application → WaroseSync"
