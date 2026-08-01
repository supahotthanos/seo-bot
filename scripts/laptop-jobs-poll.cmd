@echo off
rem Interim pre-call-audit lane (2026-07-22): the Mini's mini-jobs launchd agent is dead
rem (needs a hand reload on the Mini itself). Until then this laptop drains the queue.
rem Remove with: schtasks /Delete /TN "SeenAI-JobsPoll" /F
cd /d C:\Users\shubh\Desktop\seo-bot
for /f "usebackq tokens=1,* delims==" %%a in (".env") do set "%%a=%%b"
for /f "usebackq delims=" %%t in (`gh auth token`) do set "GH_TOKEN=%%t"
rem Debug stays ON: without it a transient GitHub API error reads as "queue empty"
rem (bit us 2026-07-23 — Eric/parfaire order sat queued while ticks looked clean).
set "SEO_BOT_JOBS_DEBUG=1"
echo [%date% %time%] tick >> "%TEMP%\seenai-jobs-poll.log"
node bin\seo-bot.mjs jobs-poll >> "%TEMP%\seenai-jobs-poll.log" 2>&1
