@echo off
rem Windowless wrapper for the "seenai-daily" scheduled task (launched hidden via C:\Users\shubh\scripts\run-hidden.vbs).
cd /d C:\Users\shubh\Desktop\seo-bot
"C:\Program Files\nodejs\node.exe" "C:\Users\shubh\Desktop\seo-bot\bin\seo-bot.mjs" schedule run --kind daily >> "%TEMP%\seenai-daily.log" 2>&1
