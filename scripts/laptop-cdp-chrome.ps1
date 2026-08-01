# seo-bot · laptop CDP Chrome (Windows ARM64 seat) — a DEDICATED capture profile, never your
# daily browser. Launches Chrome with the CDP port the capture lanes expect (9222) on its own
# user-data-dir; log into chatgpt.com ONCE in this window and the profile stays warm across
# runs. The Mini's rule holds here too: nothing touches this Chrome except the capture lanes.
#   start:  powershell -File scripts\laptop-cdp-chrome.ps1
$profileDir = Join-Path $env:LOCALAPPDATA 'seo-bot\chatgpt-profile'
New-Item -ItemType Directory -Force $profileDir | Out-Null
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Error 'Chrome not found - install Google Chrome first.'; exit 1 }
# Start-Process detaches — the capture Chrome outlives this shell (a blocking `&` call would
# tie the browser's life to whoever launched it).
Start-Process $chrome -ArgumentList @('--remote-debugging-port=9222', "--user-data-dir=$profileDir", '--no-first-run', '--no-default-browser-check', 'https://chatgpt.com')
Write-Output "Capture Chrome launched (CDP :9222, profile $profileDir)."
Write-Output 'Log into chatgpt.com ONCE in that window - then the capture lanes can drive it.'
