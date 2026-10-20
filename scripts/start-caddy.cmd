@echo off
rem Caddy reverse proxy: https://retouch.salon -> 127.0.0.1:3000
rem Kept alive by Task Scheduler "Retouch Caddy".
cd /d "C:\Users\Administrator"
if not exist "C:\Users\Administrator\Documents\retouch-system\logs" mkdir "C:\Users\Administrator\Documents\retouch-system\logs"
"C:\Users\Administrator\.local\bin\caddy.exe" run --config "C:\Users\Administrator\Caddyfile" >>"C:\Users\Administrator\Documents\retouch-system\logs\caddy.log" 2>>"C:\Users\Administrator\Documents\retouch-system\logs\caddy-error.log"
