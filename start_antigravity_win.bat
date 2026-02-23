@echo off
rem Antigravity を CDP デバッグポート付きで起動するランチャー
rem 空いているポートを自動検出して使用します
setlocal enabledelayedexpansion

set PORTS=9222 9333 9444 9555 9666
set SELECTED_PORT=

for %%p in (%PORTS%) do (
    netstat -ano | find "LISTENING" | find ":%%p " >nul
    if errorlevel 1 (
        set SELECTED_PORT=%%p
        goto :found
    )
)

:notfound
echo ❌ 利用可能なポートが見つかりませんでした (%PORTS%)
echo    いずれかのポートを使用しているプロセスを終了してください。
pause
exit /b 1

:found
echo � Antigravity をポート %SELECTED_PORT% で起動します...
start "" "Antigravity.exe" --remote-debugging-port=%SELECTED_PORT%
echo ✅ 起動完了！CDP ポート: %SELECTED_PORT%
timeout /t 2 >nul
exit /b 0
