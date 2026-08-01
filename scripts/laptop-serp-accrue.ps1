# seo-bot · GOOGLE lane on the LAPTOP seat (Shubh 2026-07-20, traveling in Canada: "get as
# much of the data as we can"). This is the laptop's PRIMARY lane — it spends ZERO ChatGPT
# budget (no account-cap collision with the Mini's 24/7 lane) and every hotel/home IP on the
# trip is a fresh, honest Google vantage. Same hard rails as the Mini: tiny per-pass slice,
# long gaps, cooldown on any /sorry/. A cold google-profile may get walled once on a new IP —
# the lane stands down by itself; opening that profile window once and clicking through
# Google's consent warms it fast.
#   start: powershell -File scripts\laptop-serp-accrue.ps1 [client]   (or Task Scheduler at logon)
#   stop:  close the window (or Stop-Process the powershell PID)
if (-not $env:SEO_BOT_VANTAGE) { $env:SEO_BOT_VANTAGE = 'laptop-ca' }
# The Google lane NEVER attaches to the ChatGPT CDP Chrome — it launches its own warm profile.
Remove-Item Env:SEO_BOT_CDP_ENDPOINT -ErrorAction SilentlyContinue
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force logs | Out-Null
$client   = if ($args.Count -ge 1) { $args[0] } else { 'nobsmedspareviews' }
$cities   = if ($env:SERP_CITIES) { $env:SERP_CITIES } else { '65' }
$maxRun   = if ($env:SERP_MAX) { $env:SERP_MAX } else { '4' }
$interval = if ($env:SERP_INTERVAL_S) { [int]$env:SERP_INTERVAL_S } else { 2400 }
while ($true) {
  $ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ssZ')
  Add-Content logs\serp-accrue.log "[$ts] laptop-serp-accrue: attempt (cities=$cities max=$maxRun vantage=$env:SEO_BOT_VANTAGE)"
  # cmd handles the stream merge natively (PS 5.1 wraps native stderr in noisy ErrorRecords)
  cmd /c "node bin\seo-bot.mjs serp-radar $client --cities $cities --max $maxRun >> logs\serp-accrue.log 2>&1"
  Add-Content logs\serp-accrue.log "[$ts] laptop-serp-accrue: rc=$LASTEXITCODE - sleeping $interval s"
  Start-Sleep -Seconds $interval
}
