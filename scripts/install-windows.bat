@echo off
REM Tally Backup Pro - Windows Installer
REM ====================================

echo Installing Tally Backup Pro...
echo.

REM Check if running as Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This installer must be run as Administrator
    echo.
    echo Right-click on this file and select "Run as administrator"
    pause
    exit /b 1
)

REM Set installation directory
set INSTALL_DIR=%PROGRAMFILES%\TallyBackupPro
set DATA_DIR=%PROGRAMDATA%\TallyBackupPro

echo Creating installation directories...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%DATA_DIR%\config" mkdir "%DATA_DIR%\config"
if not exist "%DATA_DIR%\data" mkdir "%DATA_DIR%\data"
if not exist "%DATA_DIR%\logs" mkdir "%DATA_DIR%\logs"
if not exist "%DATA_DIR%\temp" mkdir "%DATA_DIR%\temp"

echo Copying program files...
copy "tally-backup.exe" "%INSTALL_DIR%\"
copy "windows-config-tool.bat" "%INSTALL_DIR%\"
xcopy "config" "%DATA_DIR%\config\" /E /I /Y

REM Create configuration link
mklink /H "%INSTALL_DIR%\config" "%DATA_DIR%\config" >nul 2>&1

REM Add to system PATH
echo Adding to system PATH...
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "SYSTEM_PATH=%%b"
echo %SYSTEM_PATH% | find /i "%INSTALL_DIR%" >nul
if %errorLevel% neq 0 (
    setx PATH "%SYSTEM_PATH%;%INSTALL_DIR%" /M >nul
    echo PATH updated successfully
)

REM Create desktop shortcut
echo Creating desktop shortcut...
powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%PUBLIC%\Desktop\Tally Backup Pro.lnk'); $Shortcut.TargetPath = '%INSTALL_DIR%\tally-backup.exe'; $Shortcut.Arguments = 'status'; $Shortcut.WorkingDirectory = '%DATA_DIR%'; $Shortcut.Description = 'Tally Backup Pro - Check backup status'; $Shortcut.Save()"

REM Create start menu shortcut
echo Creating start menu shortcuts...
if not exist "%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\Tally Backup Pro" mkdir "%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\Tally Backup Pro"

powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\Tally Backup Pro\Tally Backup Pro.lnk'); $Shortcut.TargetPath = '%INSTALL_DIR%\tally-backup.exe'; $Shortcut.Arguments = 'status'; $Shortcut.WorkingDirectory = '%DATA_DIR%'; $Shortcut.Save()"

powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\Tally Backup Pro\Configuration Tool.lnk'); $Shortcut.TargetPath = '%INSTALL_DIR%\windows-config-tool.bat'; $Shortcut.WorkingDirectory = '%DATA_DIR%'; $Shortcut.Description = 'Configure Tally Backup Pro'; $Shortcut.Save()"

powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\Tally Backup Pro\Setup Wizard.lnk'); $Shortcut.TargetPath = '%INSTALL_DIR%\tally-backup.exe'; $Shortcut.Arguments = 'setup-wizard'; $Shortcut.WorkingDirectory = '%DATA_DIR%'; $Shortcut.Save()"

powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\Tally Backup Pro\Manual Backup.lnk'); $Shortcut.TargetPath = '%INSTALL_DIR%\tally-backup.exe'; $Shortcut.Arguments = 'backup'; $Shortcut.WorkingDirectory = '%DATA_DIR%'; $Shortcut.Save()"

REM Create uninstaller
echo Creating uninstaller...
(
echo @echo off
echo echo Uninstalling Tally Backup Pro...
echo.
echo REM Remove from PATH
echo for /f "tokens=2*" %%%%a in ^('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^^^>nul'^) do set "SYSTEM_PATH=%%%%b"
echo set "NEW_PATH=%%SYSTEM_PATH:%INSTALL_DIR%;=%%"
echo setx PATH "%%NEW_PATH%%" /M ^>nul
echo.
echo REM Remove files and directories
echo rd /s /q "%INSTALL_DIR%" 2^>nul
echo rd /s /q "%DATA_DIR%" 2^>nul
echo del "%PUBLIC%\Desktop\Tally Backup Pro.lnk" 2^>nul
echo rd /s /q "%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\Tally Backup Pro" 2^>nul
echo.
echo echo Tally Backup Pro has been uninstalled.
echo pause
) > "%INSTALL_DIR%\uninstall.bat"

echo.
echo ========================================
echo Installation completed successfully!
echo ========================================
echo.
echo Tally Backup Pro has been installed to:
echo   %INSTALL_DIR%
echo.
echo Data will be stored in:
echo   %DATA_DIR%
echo.
echo Next steps:
echo   1. Use Start Menu: "Tally Backup Pro" ^> "Configuration Tool"
echo   2. Or run: "%INSTALL_DIR%\windows-config-tool.bat"
echo   3. Follow the setup wizard for initial configuration
echo.
echo The Configuration Tool provides:
echo   - Initial Setup Wizard
echo   - Google Drive Authentication
echo   - Backup/Restore Sources Configuration
echo   - Email Notifications Setup
echo   - Manual Backup/Restore
echo.
echo Or use the desktop shortcut to get started!
echo.
pause
