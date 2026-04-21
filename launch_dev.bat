@echo off
setlocal

:: Find an available port for CDP starting from 9222
set "AG_PORT=9222"

:find_port
netstat -ano | findstr ":%AG_PORT% " >nul
if %errorlevel% equ 0 (
    set /a AG_PORT=%AG_PORT%+1
    goto find_port
)

echo [LazyLaunch] Found available CDP port: %AG_PORT%

:: Path to Antigravity executable
set "AG_PATH=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"

if not exist "%AG_PATH%" (
    echo [ERROR] Antigravity executable not found at: %AG_PATH%
    pause
    exit /b 1
)

echo [LazyLaunch] Starting Antigravity with --remote-debugging-port=%AG_PORT%...
start "" "%AG_PATH%" --remote-debugging-port=%AG_PORT%

:: Wait a moment for Antigravity to initialize the port
timeout /t 3 /nobreak >nul

:: Set environment variable to tell LazyGravity which account/port to use
:: Format: "name:port,name:port" or just "name:port"
set "ANTIGRAVITY_ACCOUNTS=local:%AG_PORT%"

echo [LazyLaunch] Starting LazyGravity (Dev Mode)...
npm run dev
