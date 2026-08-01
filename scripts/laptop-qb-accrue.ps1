# seo-bot · ChatGPT lane on the LAPTOP seat — SECONDARY; COORDINATE BEFORE RUNNING LONG.
# ⚠ SAME ACCOUNT as the Mini's 24/7 lane: the two seats cannot see each other's cooldown
# files and would fight over ONE message cap (walls for both, junk for the panel). Before a
# long laptop session, stand the Mini's ChatGPT lanes down with the committed pause switch:
#     Set-Content config\capture-pause.json '{"scopes":["chatgpt"],"reason":"laptop seat active"}'
#     git add config\capture-pause.json; git commit -m "pause: chatgpt lanes (laptop seat)"; git push
# (the Mini self-updates within a tick and its lanes refuse to start; `git rm` the file + push
# to resume). Requires scripts\laptop-cdp-chrome.ps1 running with chatgpt.com logged in.
# GENTLER than the Mini on purpose: 1 tab, 8 cells/pass, 60-min gaps — the traveler seat sips.
#   start: powershell -File scripts\laptop-qb-accrue.ps1 [client]
if (-not $env:SEO_BOT_VANTAGE) { $env:SEO_BOT_VANTAGE = 'laptop-ca' }
$env:SEO_BOT_AUTH_STATE = 'logged-in'  # the account arm; the anon lane (laptop-qb-anon.ps1) is the control
if (-not $env:SEO_BOT_CDP_ENDPOINT) { $env:SEO_BOT_CDP_ENDPOINT = 'http://localhost:9222' }
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force logs | Out-Null
$client   = if ($args.Count -ge 1) { $args[0] } else { 'nobsmedspareviews' }
$conc     = if ($env:QB_CONCURRENCY) { $env:QB_CONCURRENCY } else { '1' }
$maxRun   = if ($env:QB_MAX) { $env:QB_MAX } else { '8' }
$interval = if ($env:QB_INTERVAL_S) { [int]$env:QB_INTERVAL_S } else { 3600 }
while ($true) {
  $ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ssZ')
  Add-Content logs\query-bank-accrue.log "[$ts] laptop-qb-accrue: attempt (concurrency=$conc max=$maxRun vantage=$env:SEO_BOT_VANTAGE)"
  cmd /c "node scripts\trim-cookies.mjs >> logs\query-bank-accrue.log 2>&1"
  cmd /c "node bin\seo-bot.mjs query-bank $client --tiers low --concurrency $conc --max $maxRun >> logs\query-bank-accrue.log 2>&1"
  Add-Content logs\query-bank-accrue.log "[$ts] laptop-qb-accrue: rc=$LASTEXITCODE - sleeping $interval s"
  Start-Sleep -Seconds $interval
}
