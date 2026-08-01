# seo-bot · laptop ANON Chrome — the LOGGED-OUT vantage (Shubh 2026-07-20: "an unbiased
# opinion based off of area"). Temporary chat still applies the account's custom instructions;
# only a session with NO account carries zero personalization — what's left is IP geo + model
# defaults, i.e. what a stranger in this city gets told. NEVER log into anything in this
# window: one login destroys the vantage (if that happens, delete the profile dir and relaunch).
# Runs beside the logged-in capture Chrome: separate profile, separate CDP port (9223 vs 9222).
#   start:  powershell -File scripts\laptop-anon-chrome.ps1
$profileDir = Join-Path $env:LOCALAPPDATA 'seo-bot\chatgpt-anon-profile'
New-Item -ItemType Directory -Force $profileDir | Out-Null
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Error 'Chrome not found - install Google Chrome first.'; exit 1 }
Start-Process $chrome -ArgumentList @('--remote-debugging-port=9223', "--user-data-dir=$profileDir", '--no-first-run', '--no-default-browser-check', 'https://chatgpt.com')
Write-Output "Anon capture Chrome launched (CDP :9223, profile $profileDir)."
Write-Output 'Do NOT log into anything in that window - logged-out IS the data.'
