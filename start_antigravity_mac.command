@echo off
rem Launcher to start Antigravity with a CDP debugging port
rem Automatically detects and uses an available port + executable path
setlocal EnableExtensions EnableDelayedExpansion

set "PORTS=9222 9333 9444 9555 9666"
set "SELECTED_PORT="
set "ANTIGRAVITY_EXE="

for %%p in (%PORTS%) do (
    netstat -ano | find "LISTENING" | find ":%%p " >nul
    if errorlevel 1 (
        set "SELECTED_PORT=%%p"
        goto :port_found
    )
)

:notfound
echo [ERROR] No available ports were found (%PORTS%)
echo         Please stop any process using one of these ports.
pause
exit /b 1

:port_found
if defined ANTIGRAVITY_PATH (
    if exist "%ANTIGRAVITY_PATH%" (
        set "ANTIGRAVITY_EXE=%ANTIGRAVITY_PATH%"
    ) else (
        echo [WARN] ANTIGRAVITY_PATH is set but file not found:
        echo        %ANTIGRAVITY_PATH%
    )
)

if not defined ANTIGRAVITY_EXE (
    if defined LOCALAPPDATA (
        if exist "%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe" (
            set "ANTIGRAVITY_EXE=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
        )
    )
)

if not defined ANTIGRAVITY_EXE (
    if defined ProgramFiles (
        if exist "%ProgramFiles%\Antigravity\Antigravity.exe" (
            set "ANTIGRAVITY_EXE=%ProgramFiles%\Antigravity\Antigravity.exe"
        )
    )
)

if not defined ANTIGRAVITY_EXE (
    for /f "delims=" %%i in ('where Antigravity.exe 2^>nul') do (
        if not defined ANTIGRAVITY_EXE set "ANTIGRAVITY_EXE=%%i"
    )
)

if not defined ANTIGRAVITY_EXE (
    echo [ERROR] Could not find Antigravity.exe
    echo         Checked:
    echo           1) ANTIGRAVITY_PATH env var
    echo           2) %%LOCALAPPDATA%%\Programs\Antigravity\Antigravity.exe
    echo           3) %%ProgramFiles%%\Antigravity\Antigravity.exe
    echo           4) PATH ^(where Antigravity.exe^)
    echo.
    echo         Fix options:
    echo           - Set ANTIGRAVITY_PATH to full exe path
    echo           - Add Antigravity install dir to PATH
    pause
    exit /b 1
)

echo [INFO] Starting Antigravity on port %SELECTED_PORT%...
echo [INFO] Executable: %ANTIGRAVITY_EXE%
start "" "%ANTIGRAVITY_EXE%" --remote-debugging-port=%SELECTED_PORT%
echo [OK] Launch requested. CDP port: %SELECTED_PORT%
timeout /t 2 >nul
exit /b 0