<#
  Dezinstalează agentul Warose Sync: oprește și șterge sarcina programată.
  Folderul C:\ProgramData\WaroseSync (loguri, coadă) se păstrează, pentru verificare; ștergeți-l manual dacă nu mai e necesar.
  Rulați 'Ca administrator':  powershell -ExecutionPolicy Bypass -File .\Uninstall-WaroseSync.ps1
#>
$ErrorActionPreference = "Stop"
$task = Get-ScheduledTask -TaskName "Warose Sync" -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName "Warose Sync" -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName "Warose Sync" -Confirm:$false
  Write-Host "Sarcina 'Warose Sync' a fost ștearsă."
} else { Write-Host "Sarcina 'Warose Sync' nu există." }
$q = "C:\ProgramData\WaroseSync\queue"
if (Test-Path $q) {
  $n = @(Get-ChildItem $q -Recurse -Filter *.json -File).Count
  if ($n) { Write-Warning "$n fișiere au rămas netrimise în $q." }
}
