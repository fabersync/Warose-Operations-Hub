# Instalarea agentului Warose Sync pe calculatorul cu SAGA C (brutărie).
# Doar citește facturile primite din folderul e-Factura al SAGA; nu scrie nimic în SAGA.
$ErrorActionPreference = "Stop"
$ServerUrl = "https://warose-hub.onrender.com"
$EFactura  = "C:\SAGA C.3.0\e-Factura\DAVID_WAROSE_SRL"
$Since     = "2026-01-01"   # data facturii; pentru facturi mai vechi se reinstalează cu altă dată

Write-Host ""
Write-Host "Warose Sync - calculatorul SAGA" -ForegroundColor Cyan
Write-Host "Server:   $ServerUrl"
Write-Host "Folder:   $EFactura"
Write-Host "Facturi:  emise din $Since încoace (toate intră 'De verificat')"
Write-Host ""
Write-Host "Lipiți cheia agentului 'PC SAGA' (wrs_...) din aplicație: Setări -> Agenți de sincronizare."
Write-Host "Cheia nu se afișează pe ecran în timp ce o lipiți (clic dreapta = lipire). Apoi apăsați Enter."
$sec = Read-Host -Prompt "Cheia" -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)).Trim()
try {
  & (Join-Path $PSScriptRoot "Install-WaroseSync.ps1") -ServerUrl $ServerUrl -Token $token -EFactura $EFactura -EFacturaSince $Since
} catch {
  Write-Host ""
  Write-Host "Instalarea NU s-a încheiat: $($_.Exception.Message)" -ForegroundColor Red
}