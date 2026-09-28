@echo off
rem Newsletter (member message) email worker. Run every 5 minutes by Windows Task Scheduler.
rem Sends pending deliveries (scheduled / sending / leftover) for up to 4 minutes. See scripts/newsletter-worker.ts.
rem The worker writes logs\newsletter-worker.log itself; only unexpected crashes go to logs\newsletter-worker-error.log.
cd /d "%~dp0.."
if not exist logs mkdir logs
"C:\Program Files\nodejs\node.exe" node_modules\tsx\dist\cli.mjs scripts\newsletter-worker.ts --minutes=4 1>nul 2>>logs\newsletter-worker-error.log
