# Instalarea agentului Warose Sync pe calculatorul casei (Sibiu sau Alba Iulia).
# Agentul trimite exporturile Publine salvate în folderul de mai jos. Nu modifică Publine.
$ErrorActionPreference = "Stop"
$ServerUrl = "https://warose-hub.onrender.com"
$Folder    = "C:\Exporturi Publine"

Write-Host ""
Write-Host "Warose Sync - calculatorul casei" -ForegroundColor Cyan
Write-Host "Server: $ServerUrl"
$ales = Read-Host -Prompt "Folderul în care salvați exporturile Publine [Enter = $Folder]"
if ($ales.Trim()) { $Folder = $ales.Trim().Trim('"') }
if (-not (Test-Path -LiteralPath $Folder)) { New-Item -ItemType Directory -Path $Folder | Out-Null; Write-Host "Am creat folderul $Folder" }
Write-Host ""
Write-Host "Lipiți cheia agentului acestei case (wrs_...) din aplicație: Setări -> Agenți de sincronizare."
Write-Host "Cheia nu se afișează pe ecran în timp ce o lipiți (clic dreapta = lipire). Apoi apăsați Enter."
$sec = Read-Host -Prompt "Cheia" -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)).Trim()
try {
  & (Join-Path $PSScriptRoot "Install-WaroseSync.ps1") -ServerUrl $ServerUrl -Token $token -Publine $Folder
  Write-Host ""
  Write-Host "De acum: exportați din Publine 'Situație comenzi' în $Folder. Agentul îl trimite în cel mult 5 minute." -ForegroundColor Green
} catch {
  Write-Host ""
  Write-Host "Instalarea NU s-a încheiat: $($_.Exception.Message)" -ForegroundColor Red
}