@echo off
REM Tally Backup Pro - User-Friendly Launcher
REM ==========================================

title Tally Backup Pro

:MAIN_MENU
cls
echo.
echo ========================================
echo       🚀 Tally Backup Pro
echo ========================================
echo.
echo Choose an option:
echo.
echo   1. 🔧 Setup Wizard (First time setup)
echo   2. 🔑 Setup Google Drive Authentication
echo   3. 📂 Configure Backup Sources
echo   4. 📧 Setup Email Notifications
echo   5. ▶️  Run Manual Backup Now
echo   6. 📊 Check Backup Status
echo   7. 🔄 Start Backup Scheduler
echo   8. 🛠️  Install as Windows Service
echo   9. 📖 Open User Guide
echo   0. ❌ Exit
echo.
set /p "choice=Enter your choice (0-9): "

if "%choice%"=="1" goto SETUP_WIZARD
if "%choice%"=="2" goto SETUP_AUTH
if "%choice%"=="3" goto SETUP_SOURCES
if "%choice%"=="4" goto SETUP_EMAIL
if "%choice%"=="5" goto MANUAL_BACKUP
if "%choice%"=="6" goto CHECK_STATUS
if "%choice%"=="7" goto START_SCHEDULER
if "%choice%"=="8" goto INSTALL_SERVICE
if "%choice%"=="9" goto OPEN_GUIDE
if "%choice%"=="0" goto EXIT

echo Invalid choice. Please try again.
timeout /t 2 >nul
goto MAIN_MENU

:SETUP_WIZARD
echo.
echo 🔧 Starting Setup Wizard...
echo.
tally-backup.exe setup-wizard
pause
goto MAIN_MENU

:SETUP_AUTH
echo.
echo 🔑 Setting up Google Drive Authentication...
echo.
tally-backup.exe setup-auth
pause
goto MAIN_MENU

:SETUP_SOURCES
echo.
echo 📂 Configuring Backup Sources...
echo.
tally-backup.exe setup-sources
pause
goto MAIN_MENU

:SETUP_EMAIL
echo.
echo 📧 Setting up Email Notifications...
echo.
tally-backup.exe setup-email
pause
goto MAIN_MENU

:MANUAL_BACKUP
echo.
echo ▶️  Running Manual Backup...
echo.
tally-backup.exe backup
pause
goto MAIN_MENU

:CHECK_STATUS
echo.
echo 📊 Checking Backup Status...
echo.
tally-backup.exe status
pause
goto MAIN_MENU

:START_SCHEDULER
echo.
echo 🔄 Starting Backup Scheduler...
echo This will run in the background. Press Ctrl+C to stop.
echo.
tally-backup.exe start
pause
goto MAIN_MENU

:INSTALL_SERVICE
echo.
echo 🛠️  Installing as Windows Service...
echo.
tally-backup.exe install-service
pause
goto MAIN_MENU

:OPEN_GUIDE
echo.
echo 📖 Opening User Guide...
echo.
if exist "docs\windows-user-guide.md" (
    start "" "docs\windows-user-guide.md"
) else (
    echo User guide not found in docs\windows-user-guide.md
)
pause
goto MAIN_MENU

:EXIT
echo.
echo 👋 Goodbye!
exit /b 0
