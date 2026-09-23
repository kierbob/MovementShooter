@echo off
title Movement Shooter - server
cd /d "%~dp0"

python --version >nul 2>&1
if errorlevel 1 (
    echo Python was not found.
    echo.
    echo Make sure Python is installed and added to PATH.
    pause
    exit /b 1
)

echo Starting Movement Shooter...
echo.

start "" cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:5173"

python serve.py
pause