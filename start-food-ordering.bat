@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
start "Xepon Food Ordering" cmd /k "npm run dev -- --host 0.0.0.0 --port 4173"
timeout /t 2 /nobreak >nul
start "" "http://localhost:4173"
