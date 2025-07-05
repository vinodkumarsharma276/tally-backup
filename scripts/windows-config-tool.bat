@echo off
REM Tally Backup Pro - Windows Configuration Tool
REM =============================================

setlocal enabledelayedexpansion

echo.
echo ========================================
echo   Tally Backup Pro - Configuration Tool
echo ========================================
echo.

REM Check if running from correct directory
set "CONFIG_DIR=%PROGRAMDATA%\TallyBackupPro\config"
set "INSTALL_DIR=%PROGRAMFILES%\TallyBackupPro"

if not exist "%CONFIG_DIR%" (
    echo ERROR: Tally Backup Pro is not properly installed.
    echo Expected config directory: %CONFIG_DIR%
    echo.
    echo Please run the installer first.
    pause
    exit /b 1
)

cd /d "%CONFIG_DIR%\.."

:MAIN_MENU
cls
echo.
echo ========================================
echo   Tally Backup Pro - Configuration
echo ========================================
echo.
echo Current configuration location:
echo   %CONFIG_DIR%
echo.
echo Configuration Options:
echo   1. Initial Setup Wizard (recommended for first time)
echo   2. Configure Authentication (Google Drive)
echo   3. Configure Sources (Backup/Restore folders)
echo   4. Configure Email Notifications
echo   5. Test Email Configuration
echo   6. Manual Backup (run now)
echo   7. Check Status
echo   8. Edit Config File Manually
echo   9. Open Config Folder in Explorer
echo   0. Exit
echo.
set /p "choice=Choose an option (0-9): "

if "%choice%"=="1" goto SETUP_WIZARD
if "%choice%"=="2" goto SETUP_AUTH
if "%choice%"=="3" goto SETUP_SOURCES
if "%choice%"=="4" goto SETUP_EMAIL
if "%choice%"=="5" goto TEST_EMAIL
if "%choice%"=="6" goto MANUAL_BACKUP
if "%choice%"=="7" goto CHECK_STATUS
if "%choice%"=="8" goto EDIT_CONFIG
if "%choice%"=="9" goto OPEN_FOLDER
if "%choice%"=="0" goto EXIT

echo Invalid choice. Please try again.
timeout /t 2 >nul
goto MAIN_MENU

:SETUP_WIZARD
echo.
echo Running Initial Setup Wizard...
echo.
"%INSTALL_DIR%\tally-backup.exe" setup-wizard
echo.
echo Setup wizard completed. Returning to main menu...
pause
goto MAIN_MENU

:SETUP_AUTH
echo.
echo Setting up Google Drive Authentication...
echo.
echo This will help you connect to Google Drive.
echo You'll need to:
echo   1. Visit a Google authorization URL
echo   2. Grant permissions
echo   3. Copy the authorization code
echo.
pause
"%INSTALL_DIR%\tally-backup.exe" setup-auth
echo.
echo Authentication setup completed.
pause
goto MAIN_MENU

:SETUP_SOURCES
echo.
echo Configuring Backup and Restore Sources...
echo.
echo This allows you to:
echo   - Add folders to backup (Local → Google Drive)
echo   - Add folders to restore (Google Drive → Local)
echo   - Edit existing sources
echo   - Remove sources
echo.
pause
"%INSTALL_DIR%\tally-backup.exe" setup-sources
echo.
echo Sources configuration completed.
pause
goto MAIN_MENU

:SETUP_EMAIL
echo.
echo Configuring Email Notifications...
echo.
echo This will set up email reports for backup status.
echo Supports Gmail, Outlook, and other SMTP servers.
echo.
pause
"%INSTALL_DIR%\tally-backup.exe" setup-email
echo.
echo Email configuration completed.
pause
goto MAIN_MENU

:TEST_EMAIL
echo.
echo Testing Email Configuration...
echo.
"%INSTALL_DIR%\tally-backup.exe" test-email
echo.
pause
goto MAIN_MENU

:MANUAL_BACKUP
echo.
echo Running Manual Backup/Restore...
echo.
echo This will process all configured sources:
echo   - Backup sources: Upload changes to Google Drive
echo   - Restore sources: Download changes from Google Drive
echo.
pause
"%INSTALL_DIR%\tally-backup.exe" backup
echo.
echo Manual backup completed.
pause
goto MAIN_MENU

:CHECK_STATUS
echo.
echo Checking Backup Status...
echo.
"%INSTALL_DIR%\tally-backup.exe" status
echo.
pause
goto MAIN_MENU

:EDIT_CONFIG
echo.
echo Opening config.json for manual editing...
echo.
echo WARNING: Manual editing requires JSON knowledge.
echo Make sure to backup the file before making changes.
echo.
set /p "confirm=Continue? (y/N): "
if /i not "%confirm%"=="y" goto MAIN_MENU

if exist "%PROGRAMFILES%\Notepad++\notepad++.exe" (
    start "" "%PROGRAMFILES%\Notepad++\notepad++.exe" "%CONFIG_DIR%\config.json"
) else if exist "%WINDIR%\System32\notepad.exe" (
    start "" notepad "%CONFIG_DIR%\config.json"
) else (
    echo No suitable text editor found.
    echo Please manually open: %CONFIG_DIR%\config.json
)
echo.
echo Config file opened for editing.
pause
goto MAIN_MENU

:OPEN_FOLDER
echo.
echo Opening configuration folder...
start "" explorer "%CONFIG_DIR%"
goto MAIN_MENU

:EXIT
echo.
echo Configuration tool closed.
exit /b 0
