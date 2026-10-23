@echo off
rem Warose Sync - instalare pe calculatorul casei de marcat (exporturi Publine).
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instaleaza-PC-CASA.ps1"
echo.
pause