@echo off
rem Production Next.js on port 3000 (.next-prod). Kept alive by Task Scheduler "Retouch Live".
rem Caddy (retouch.salon) reverse-proxies to 127.0.0.1:3000.
cd /d "%~dp0.."
if not exist logs mkdir logs
"C:\Program Files\nodejs\node.exe" scripts\live.js start >>logs\live.log 2>>logs\live-error.log
