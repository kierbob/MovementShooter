@echo off
title Movement Shooter - ONLINE server (Cloudflare tunnel)
cd /d "%~dp0server"

where node >nul 2>nul || (
  echo Node.js was not found. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing server dependencies...
  call npm install --no-audit --no-fund
)

node host.js
pause
