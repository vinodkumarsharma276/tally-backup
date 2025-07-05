@echo off
REM Tally Backup Pro - User Installation (No Admin Required)
REM ========================================================

setlocal enabledelayedexpansion

echo.
echo ========================================
echo   Tally Backup Pro v1.0.0 - User Install
echo ========================================
echo.

REM Check if running as Administrator
net session >nul 2>&1
if %errorLevel% == 0 (
    echo WARNING: Running as Administrator detected.
    echo For system-wide installation, use install-windows.bat
    echo.
    echo This installer will install for current user only.
    echo.
    set /p "continue=Continue with user installation? (y/N): "
    if /i not "!continue!"=="y" (
        echo Installation cancelled.
        pause
        exit /b 1
    )
    echo.
)

REM Set user installation directory
set USER_INSTALL_DIR=%LOCALAPPDATA%\TallyBackupPro
set USER_DATA_DIR=%APPDATA%\TallyBackupPro

echo Installing to user directory...
echo   Program: %USER_INSTALL_DIR%
echo   Data:    %USER_DATA_DIR%
echo.

REM Create user directories
echo Creating directories...
if not exist "%USER_INSTALL_DIR%" mkdir "%USER_INSTALL_DIR%"
if not exist "%USER_DATA_DIR%" mkdir "%USER_DATA_DIR%"
if not exist "%USER_DATA_DIR%\config" mkdir "%USER_DATA_DIR%\config"
if not exist "%USER_DATA_DIR%\data" mkdir "%USER_DATA_DIR%\data"
if not exist "%USER_DATA_DIR%\logs" mkdir "%USER_DATA_DIR%\logs"
if not exist "%USER_DATA_DIR%\temp" mkdir "%USER_DATA_DIR%\temp"

REM Copy program files
echo Copying program files...
if exist "tally-backup.exe" (
    copy "tally-backup.exe" "%USER_INSTALL_DIR%\" >nul
    echo   ✓ tally-backup.exe copied
) else (
    echo   ❌ tally-backup.exe not found
)

if exist "windows-config-tool.bat" (
    copy "windows-config-tool.bat" "%USER_INSTALL_DIR%\" >nul
    echo   ✓ windows-config-tool.bat copied
) else (
    echo   ❌ windows-config-tool.bat not found
)

if exist "tally-backup-launcher.bat" (
    copy "tally-backup-launcher.bat" "%USER_INSTALL_DIR%\" >nul
    echo   ✓ tally-backup-launcher.bat copied
) else (
    echo   ⚠️  tally-backup-launcher.bat not found (optional)
)

REM Copy configuration files
echo Copying configuration files...
if exist "config" (
    xcopy "config" "%USER_DATA_DIR%\config\" /E /I /Y >nul
    echo   ✓ Configuration files copied
) else (
    echo   ❌ config directory not found
)

REM Create working directory links
echo Creating directory links...
pushd "%USER_INSTALL_DIR%"
if exist "config" rmdir "config" >nul 2>&1
if exist "data" rmdir "data" >nul 2>&1
if exist "logs" rmdir "logs" >nul 2>&1
if exist "temp" rmdir "temp" >nul 2>&1

mklink /J "config" "%USER_DATA_DIR%\config" >nul 2>&1
mklink /J "data" "%USER_DATA_DIR%\data" >nul 2>&1
mklink /J "logs" "%USER_DATA_DIR%\logs" >nul 2>&1
mklink /J "temp" "%USER_DATA_DIR%\temp" >nul 2>&1
popd

REM Create desktop shortcut
echo Creating desktop shortcuts...
powershell -Command "try { $WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%USERPROFILE%\Desktop\Tally Backup Config.lnk'); $Shortcut.TargetPath = '%USER_INSTALL_DIR%\windows-config-tool.bat'; $Shortcut.WorkingDirectory = '%USER_INSTALL_DIR%'; $Shortcut.Description = 'Tally Backup Pro - Configuration Tool'; $Shortcut.Save(); Write-Host '  ✓ Desktop shortcut created' } catch { Write-Host '  ❌ Failed to create desktop shortcut' }"

REM Create start menu shortcut for current user
echo Creating start menu shortcuts...
set START_MENU_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Tally Backup Pro
if not exist "%START_MENU_DIR%" mkdir "%START_MENU_DIR%"

powershell -Command "try { $WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%START_MENU_DIR%\Tally Backup Pro.lnk'); $Shortcut.TargetPath = '%USER_INSTALL_DIR%\tally-backup.exe'; $Shortcut.WorkingDirectory = '%USER_INSTALL_DIR%'; $Shortcut.Description = 'Tally Backup Pro'; $Shortcut.Save(); Write-Host '  ✓ Start menu shortcut created' } catch { Write-Host '  ❌ Failed to create start menu shortcut' }"

powershell -Command "try { $WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%START_MENU_DIR%\Configuration Tool.lnk'); $Shortcut.TargetPath = '%USER_INSTALL_DIR%\windows-config-tool.bat'; $Shortcut.WorkingDirectory = '%USER_INSTALL_DIR%'; $Shortcut.Description = 'Configure Tally Backup Pro'; $Shortcut.Save(); Write-Host '  ✓ Configuration tool shortcut created' } catch { Write-Host '  ❌ Failed to create configuration shortcut' }"

powershell -Command "try { $WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%START_MENU_DIR%\Setup Wizard.lnk'); $Shortcut.TargetPath = '%USER_INSTALL_DIR%\tally-backup.exe'; $Shortcut.Arguments = 'setup-wizard'; $Shortcut.WorkingDirectory = '%USER_INSTALL_DIR%'; $Shortcut.Description = 'Run Tally Backup Setup Wizard'; $Shortcut.Save(); Write-Host '  ✓ Setup wizard shortcut created' } catch { Write-Host '  ❌ Failed to create setup wizard shortcut' }"

REM Create uninstaller
echo Creating uninstaller...
(
echo @echo off
echo echo Uninstalling Tally Backup Pro ^(User Installation^)...
echo echo.
echo echo Removing files and directories...
echo rd /s /q "%USER_INSTALL_DIR%" 2^>nul
echo rd /s /q "%USER_DATA_DIR%" 2^>nul
echo del "%USERPROFILE%\Desktop\Tally Backup Config.lnk" 2^>nul
echo rd /s /q "%START_MENU_DIR%" 2^>nul
echo echo.
echo echo Tally Backup Pro has been uninstalled from user profile.
echo pause
) > "%USER_INSTALL_DIR%\uninstall-user.bat"

echo.
echo ========================================
echo   Installation completed successfully!
echo ========================================
echo.
echo Tally Backup Pro has been installed for current user:
echo   Program: %USER_INSTALL_DIR%
echo   Data:    %USER_DATA_DIR%
echo.
echo 🚀 Quick Start:
echo   1. Double-click "Tally Backup Config" on desktop
echo   2. Choose "1. Setup Wizard" for first-time setup
echo   3. Follow the step-by-step configuration
echo.
echo 📂 Alternative access:
echo   - Start Menu: Tally Backup Pro
echo   - Direct: %USER_INSTALL_DIR%\windows-config-tool.bat
echo.
echo 📧 Need help? Check the user guide or contact support.
echo.
pause
