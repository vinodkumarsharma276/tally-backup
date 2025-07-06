@echo off
setlocal

REM ============================================================
REM Tally Backup Pro - Client Installation Script
REM ============================================================

echo.
echo ============================================================
echo    🚀 Tally Backup Pro - Client Installation
echo ============================================================
echo.

REM Check if Node.js is installed
echo 📋 Checking system requirements...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed or not in PATH
    echo.
    echo Please install Node.js from https://nodejs.org/
    echo Minimum version required: 14.0.0
    echo.
    pause
    exit /b 1
)

echo ✅ Node.js found
node --version

REM Check if npm is available
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm is not available
    echo Please ensure npm is installed with Node.js
    pause
    exit /b 1
)

echo ✅ npm found
npm --version
echo.

REM Create Documents\TallyBackupApp directory
echo 📁 Creating installation directory...
set "INSTALL_DIR=%USERPROFILE%\Documents\TallyBackupApp"
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
echo ✅ Installation directory created: %INSTALL_DIR%
echo.

REM Look for the package file in Downloads folder
echo 📦 Locating installation package...
set "DOWNLOADS_DIR=%USERPROFILE%\Downloads"
if exist "%DOWNLOADS_DIR%\tally-backup-pro-1.0.0-obfuscated.tgz" (
    echo ✅ Package found in Downloads folder
) else (
    echo ❌ tally-backup-pro-1.0.0-obfuscated.tgz not found in Downloads folder
    echo Please ensure the package file is in your Downloads folder
    pause
    exit /b 1
)
echo.

REM Install the package locally
echo 🔧 Installing Tally Backup Pro locally...
cd /d "%INSTALL_DIR%"
npm install "%DOWNLOADS_DIR%\tally-backup-pro-1.0.0-obfuscated.tgz"
if %errorlevel% neq 0 (
    echo ❌ Installation failed
    echo Please check your internet connection and try again
    pause
    exit /b 1
)
echo ✅ Tally Backup Pro installed successfully
echo.

REM Display installation completion
echo ============================================================
echo    ✅ Installation Completed Successfully!
echo ============================================================
echo.
echo 📁 Installation Location: %INSTALL_DIR%
echo.
echo 🚀 Starting Tally Backup Pro...
echo.

REM Launch the application with help menu
echo 🔧 Opening command prompt with Tally Backup Pro help...
start cmd /k "cd /d "%INSTALL_DIR%" && npx tally-backup --help && echo. && echo ============================================================ && echo    🎯 QUICK ACTIONS: && echo ============================================================ && echo. && echo 1. Run backup now: npx tally-backup backup && echo 2. Schedule daily backup (9 PM): npx tally-backup schedule --time 21:00 && echo 3. Setup Google Drive: npx tally-backup setup-auth && echo 4. Initialize config: npx tally-backup init && echo 5. Test email: npx tally-backup test-email && echo 6. Setup wizard: npx tally-backup setup-wizard && echo."
echo.
echo 🎉 Installation completed! Command prompt opened with help menu.
echo.
echo 💡 The new command window shows all available options including:
echo    • Run backup immediately
echo    • Schedule daily backup at 9 PM
echo    • Setup Google Drive authentication
echo    • Initialize configuration
echo    • Test email settings
echo.
pause
