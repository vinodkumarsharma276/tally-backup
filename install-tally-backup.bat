@echo off
setlocal

echo.
echo ============================================================
echo    Tally Backup Pro - Client Installation
echo ============================================================
echo.

echo [*] Checking system requirements...
call node --version
echo [OK] Node.js found

echo [*] Checking npm availability...
call npm --version
echo [OK] npm found
echo.

echo [*] Creating installation directory...
set "INSTALL_DIR=%USERPROFILE%\Documents\TallyBackupApp"
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
echo [OK] Installation directory created: %INSTALL_DIR%
echo.

echo [*] Locating installation package...
set "DOWNLOADS_DIR=%USERPROFILE%\Downloads"
if exist "%DOWNLOADS_DIR%\tally-backup-pro-1.1.0-obfuscated.tgz" (
    echo [OK] Package found in Downloads folder
) else (
    echo [ERROR] tally-backup-pro-1.1.0-obfuscated.tgz not found in Downloads folder
    echo Please ensure the package file is in your Downloads folder
    pause
    exit /b 1
)
echo.

echo [*] Installing Tally Backup Pro locally...
cd /d "%INSTALL_DIR%"
call npm install "%DOWNLOADS_DIR%\tally-backup-pro-1.1.0-obfuscated.tgz"
if %errorlevel% neq 0 (
    echo [ERROR] Installation failed
    echo Please check your internet connection and try again
    pause
    exit /b 1
)
echo [OK] Tally Backup Pro installed successfully
echo.

echo [*] Setting up additional tools...
echo [*] Copying task scheduler setup script...
copy "%INSTALL_DIR%\node_modules\tally-backup-pro\scripts\setup-task-scheduler.bat" "%INSTALL_DIR%\" >nul 2>&1
if exist "%INSTALL_DIR%\setup-task-scheduler.bat" (
    echo [OK] Task scheduler setup script copied
) else (
    echo [WARN] Could not copy task scheduler setup script
)

echo [*] Setting up application directories...
echo [*] Moving directories from node_modules to installation directory...

REM Move config directory if it exists in node_modules
if exist "%INSTALL_DIR%\node_modules\tally-backup-pro\config" (
    if not exist "%INSTALL_DIR%\config" (
        move "%INSTALL_DIR%\node_modules\tally-backup-pro\config" "%INSTALL_DIR%\config" >nul 2>&1
        if exist "%INSTALL_DIR%\config" (
            echo [OK] Config directory moved to installation location
        ) else (
            echo [WARN] Could not move config directory
        )
    ) else (
        echo [OK] Config directory already exists in installation location
    )
)

REM Move data directory if it exists in node_modules
if exist "%INSTALL_DIR%\node_modules\tally-backup-pro\data" (
    if not exist "%INSTALL_DIR%\data" (
        move "%INSTALL_DIR%\node_modules\tally-backup-pro\data" "%INSTALL_DIR%\data" >nul 2>&1
        if exist "%INSTALL_DIR%\data" (
            echo [OK] Data directory moved to installation location
        ) else (
            echo [WARN] Could not move data directory
        )
    ) else (
        echo [OK] Data directory already exists in installation location
    )
)

REM Move logs directory if it exists in node_modules
if exist "%INSTALL_DIR%\node_modules\tally-backup-pro\logs" (
    if not exist "%INSTALL_DIR%\logs" (
        move "%INSTALL_DIR%\node_modules\tally-backup-pro\logs" "%INSTALL_DIR%\logs" >nul 2>&1
        if exist "%INSTALL_DIR%\logs" (
            echo [OK] Logs directory moved to installation location
        ) else (
            echo [WARN] Could not move logs directory
        )
    ) else (
        echo [OK] Logs directory already exists in installation location
    )
)

REM Create temp directory if it doesn't exist
if not exist "%INSTALL_DIR%\temp" (
    mkdir "%INSTALL_DIR%\temp" >nul 2>&1
    if exist "%INSTALL_DIR%\temp" (
        echo [OK] Temp directory created in installation location
    ) else (
        echo [WARN] Could not create temp directory
    )
) else (
    echo [OK] Temp directory already exists in installation location
)

echo [*] Directory setup completed
echo.

echo ============================================================
echo    Installation Completed Successfully!
echo ============================================================
echo.
echo Installation Location: %INSTALL_DIR%
echo.
echo [*] Starting Tally Backup Pro...
echo.

echo [*] Opening command prompt with Tally Backup Pro help...
start cmd /k "cd /d "%INSTALL_DIR%" && npx tally-backup --help && echo. && echo ============================================================ && echo    QUICK ACTIONS: && echo ============================================================ && echo. && echo 1. Run backup now: npx tally-backup backup && echo 2. Setup Windows Task Scheduler: setup-task-scheduler.bat && echo 3. Create basic scheduler: npx tally-backup schedule --time 21:00 && echo 4. Setup Google Drive: npx tally-backup setup-auth && echo 5. Initialize config: npx tally-backup init && echo 6. Test email: npx tally-backup test-email && echo 7. Setup wizard: npx tally-backup setup-wizard && echo."
echo.
echo Installation completed! Command prompt opened with help menu.
echo.
echo The new command window shows all available options including:
echo    - Run backup immediately
echo    - Setup Windows Task Scheduler (recommended for daily backups)
echo    - Create basic scheduler script
echo    - Setup Google Drive authentication
echo    - Initialize configuration
echo    - Test email settings
echo.
pause
