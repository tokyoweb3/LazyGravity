@echo off
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Install Node.js 22.14 or newer first.
    pause
    exit /b 1
)

if not exist "node_modules\typescript\bin\tsc" (
    echo [INFO] Installing project dependencies...
    set "PUPPETEER_SKIP_DOWNLOAD=true"
    call npm ci --no-audit --no-fund
    if errorlevel 1 goto :failed
)

echo [INFO] Building LazyGravity...
call npm run build
if errorlevel 1 goto :failed

node dist\bin\cli.js open
if errorlevel 1 goto :failed

echo [INFO] Starting the Discord bot. Keep this window open; press Ctrl+C to stop.
node dist\bin\cli.js start
if errorlevel 1 goto :failed
exit /b 0

:failed
echo [ERROR] Startup failed. Read the message above.
pause
exit /b 1
