# seo-bot · ChatGPT LOGGED-OUT lane on the laptop — the personalization-free control arm.
# Rows land in the SAME panel stamped authState=logged-out, so the analytics can hold auth
# state fixed (same prompt logged-in vs logged-out = the personalization delta, measured).
# NO account cap is spent here (no account!) — but logged-out sessions hit Cloudflare and
# anonymous message walls FASTER, so this lane is the gentlest of all: 1 tab, 6 cells/pass,
# 90-min gaps, and the runner's wall detection + cooldown do the rest.
# Requires scripts\laptop-anon-chrome.ps1 running (CDP :9223) — and NEVER logged in.
#   start: powershell -File scripts\laptop-qb-anon.ps1 [client]
if (-not $env:SEO_BOT_VANTAGE) { $env:SEO_BOT_VANTAGE = 'laptop-ca' }
$env:SEO_BOT_AUTH_STATE = 'logged-out'
$env:SEO_BOT_CDP_ENDPOINT = 'http://localhost:9223'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force logs | Out-Null
$client   = if ($args.Count -ge 1) { $args[0] } else { 'nobsmedspareviews' }
$conc     = '1'
$maxRun   = if ($env:QB_MAX) { $env:QB_MAX } else { '6' }
$interval = if ($env:QB_INTERVAL_S) { [int]$env:QB_INTERVAL_S } else { 5400 }
while ($true) {
  $ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ssZ')
  Add-Content logs\qb-anon.log "[$ts] laptop-qb-anon: attempt (max=$maxRun vantage=$env:SEO_BOT_VANTAGE auth=logged-out)"
  cmd /c "node scripts\trim-cookies.mjs >> logs\qb-anon.log 2>&1"
  cmd /c "node bin\seo-bot.mjs query-bank $client --tiers low --concurrency $conc --max $maxRun >> logs\qb-anon.log 2>&1"
  Add-Content logs\qb-anon.log "[$ts] laptop-qb-anon: rc=$LASTEXITCODE - sleeping $interval s"
  Start-Sleep -Seconds $interval
}
