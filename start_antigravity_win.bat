@echo off
rem Launcher to start Antigravity with a CDP debugging port
rem Automatically detects and uses an available port
setlocal enabledelayedexpansion

set PORTS=9222 9223 9333 9444 9555 9666
if defined ANTIGRAVITY_ACCOUNTS (
    set PORTS=
    for %%a in (%ANTIGRAVITY_ACCOUNTS:,= %) do (
        for /f "tokens=1,2 delims=:" %%n in ("%%a") do (
            if not "%%o"=="" set PORTS=!PORTS! %%o
        )
    )
    if "%PORTS%"=="" set PORTS=9222 9223 9333 9444 9555 9666
)
set SELECTED_PORT=

for %%p in (%PORTS%) do (
    netstat -ano | find "LISTENING" | find ":%%p " >nul
    if errorlevel 1 (
        set SELECTED_PORT=%%p
        goto :found
    )
)

:notfound
echo [ERROR] No available ports were found (%PORTS%)
echo    Please stop any process using one of these ports.
pause
exit /b 1

:found
echo [INFO] Starting Antigravity on port %SELECTED_PORT%...
start "" "Antigravity.exe" --remote-debugging-port=%SELECTED_PORT%
echo [OK] Launch complete! CDP port: %SELECTED_PORT%
timeout /t 2 >nul
exit /b 0
