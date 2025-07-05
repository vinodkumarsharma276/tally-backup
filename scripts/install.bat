@echo off
REM Tally Backup Pro - Installation Selector
REM ========================================

title Tally Backup Pro - Installation

echo.
echo ========================================
echo     🚀 Tally Backup Pro v1.0.0
echo ========================================
echo.
echo Choose installation type:
echo.
echo   1. 👤 User Installation (Recommended)
echo      - No administrator privileges required
echo      - Installs for current user only
echo      - Data stored in user profile
echo.
echo   2. 🔧 System Installation (Advanced)
echo      - Requires administrator privileges
echo      - Installs for all users
echo      - Data stored in system directories
echo.
echo   3. ❌ Exit
echo.
set /p "choice=Enter your choice (1-3): "

if "%choice%"=="1" goto USER_INSTALL
if "%choice%"=="2" goto SYSTEM_INSTALL
if "%choice%"=="3" goto EXIT

echo Invalid choice. Please try again.
timeout /t 2 >nul
goto START

:USER_INSTALL
echo.
echo Starting User Installation...
echo.
if exist "install-user.bat" (
    call install-user.bat
) else (
    echo ERROR: install-user.bat not found
    pause
)
goto END

:SYSTEM_INSTALL
echo.
echo Starting System Installation...
echo.
echo ⚠️  This requires Administrator privileges
echo.
set /p "confirm=Continue? (y/N): "
if /i not "%confirm%"=="y" goto START

if exist "install-windows.bat" (
    call install-windows.bat
) else (
    echo ERROR: install-windows.bat not found
    pause
)
goto END

:EXIT
echo.
echo Installation cancelled.
goto END

:END
echo.
echo Thank you for using Tally Backup Pro!
pause
