@echo off
setlocal

echo ============================================================
echo   Tally Backup Pro - Windows Task Scheduler Setup
echo ============================================================
echo.

REM Check if we're running from the correct directory
if not exist "node_modules\tally-backup-pro" (
    echo [ERROR] This script must be run from the TallyBackupApp directory
    echo Expected location: %USERPROFILE%\Documents\TallyBackupApp
    echo.
    echo Please navigate to the correct directory and run this script again.
    pause
    exit /b 1
)

REM Get the current directory (should be TallyBackupApp)
set "INSTALL_DIR=%CD%"
echo [*] Installation directory: %INSTALL_DIR%
echo.

echo [*] Setting up Windows Task Scheduler for daily backup at 9 PM...
echo.

REM Ensure logs directory exists
if not exist "logs" mkdir "logs"

REM Create the batch file that will be run by Task Scheduler
echo [*] Creating task runner script...
echo @echo off > run-backup.bat
echo cd /d "%INSTALL_DIR%" >> run-backup.bat
echo npx tally-backup backup ^>^> logs\scheduled-backup.log 2^>^&1 >> run-backup.bat

echo [*] Creating Windows Scheduled Task...

REM Create the scheduled task
schtasks /create /tn "Tally Backup Pro - Daily Backup" /tr "\"%INSTALL_DIR%\run-backup.bat\"" /sc daily /st 21:00 /f

if %errorlevel% equ 0 (
    echo.
    echo ============================================================
    echo   Task Scheduler Setup Complete!
    echo ============================================================
    echo.
    echo 📅 Task Name: Tally Backup Pro - Daily Backup
    echo ⏰ Schedule: Daily at 9:00 PM
    echo 📁 Logs: %INSTALL_DIR%\logs\scheduled-backup.log
    echo.
    echo 🎯 To manage this task:
    echo    - Open Task Scheduler: taskschd.msc
    echo    - Or use: schtasks /query /tn "Tally Backup Pro - Daily Backup"
    echo.
    echo 🗑️ To remove this task:
    echo    - Run: schtasks /delete /tn "Tally Backup Pro - Daily Backup" /f
    echo.
) else (
    echo [ERROR] Failed to create scheduled task
    echo Please run this script as administrator
)

echo [*] Testing the backup task...
echo You can test the backup now by running: npx tally-backup backup
echo.
pause
