@echo off
rem Contractor feed for mgmdrill.com: mailbox -> SharePoint -> shift_entries. Scheduled at 12:00 and 00:00.
set PYTHONIOENCODING=utf-8
set LOG=%USERPROFILE%\Docs\mgm-drill\private\contractor_sync.log
echo ==== %date% %time% >> "%LOG%"
cd /d "%USERPROFILE%\Desktop\MGM"
py -3 -I tools\outlook_export.py --only mail --app e64ce77b-acdd-4faa-871a-9d799286873f >> "%LOG%" 2>&1
py -3 -I tools\file_daily_reports.py --tidy >> "%LOG%" 2>&1
cd /d "%USERPROFILE%\Docs\mgm-drill"
py -3 -I tools\contractor_sync.py --no-rjll >> "%LOG%" 2>&1
echo exit %ERRORLEVEL% >> "%LOG%"
