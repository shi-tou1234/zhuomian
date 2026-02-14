@echo off
setlocal
title Dashboard Launcher

echo ==========================================
echo       Dashboard Startup Script
echo ==========================================

rem Ensure Electron mirror in restricted networks
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

rem Check and install dependencies
if not exist node_modules (
    echo [INFO] node_modules not found. Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
) else (
    if not exist node_modules\electron\package.json (
        echo [INFO] Electron not found. Installing dependencies...
        call npm install
        if errorlevel 1 (
            echo [ERROR] Failed to install dependencies.
            pause
            exit /b 1
        )
    )
)

rem Repair Electron if installed but binary missing (common when install scripts were skipped)
if exist node_modules\electron\package.json (
    if not exist node_modules\electron\path.txt (
        echo [WARN] Electron binary seems missing. Rebuilding Electron...
        call npm rebuild electron --force
    )
    if not exist node_modules\electron\path.txt (
        echo [WARN] Electron rebuild did not restore binary. Reinstalling Electron...
        call npm install electron --save-dev --force
    )
    if not exist node_modules\electron\path.txt (
        echo [ERROR] Electron still not installed correctly. Please delete node_modules and run start.bat again.
        pause
        exit /b 1
    )
)

rem Start Dev Server
echo [INFO] Checking if port 5173 is already in use...
netstat -ano | findstr :5173 | findstr LISTENING >nul
if %errorlevel% equ 0 (
    echo [INFO] Port 5173 is already active. Skipping Vite Dev Server start.
) else (
    echo [INFO] Starting Vite Dev Server on port 5173...
    rem Use /k to keep window open if it crashes, helpful for debugging
    start "Dashboard Dev Server" cmd /k "npm run dev"
)

rem Wait for server to be ready
echo [INFO] Waiting for Dev Server...
:wait_loop
timeout /t 2 >nul
curl -s http://localhost:5173/ >nul
if %errorlevel% neq 0 (
    echo [INFO] Waiting for http://localhost:5173/...
    goto wait_loop
)

echo [INFO] Dev Server is ready!

rem Ensure dist exists for fallback
if not exist "dist\index.html" (
    echo [WARN] dist folder not found. Building project...
    call npm run build
)

rem Start Electron Window in CURRENT console to show logs
echo [INFO] Launching Desktop Window...
echo [INFO] If the window does not appear, please check the logs below:
echo ---------------------------------------------------
set VITE_DEV_SERVER_URL=http://localhost:5173/
call npm run desktop

echo ---------------------------------------------------
echo [INFO] Desktop process exited. 
echo [INFO] If you see errors above, please take a screenshot or copy them.
pause
endlocal
