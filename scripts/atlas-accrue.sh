#!/bin/zsh
# seo-bot · atlas accrual loop — paced ChatGPT fan-out coverage (operator order 2026-07-12:
# "run the ChatGPT engine, do the fan-out reverse engineering across cities").
# Attempts one governor-paced atlas run, then sleeps ATLAS_INTERVAL_S (default 6h30m — past the
# 6h cooldown window). The runner's own cooldown gate makes premature attempts a safe no-op and
# the message-cap/throttle halts politely, so this loop can NEVER re-hammer the account.
#   start:  nohup zsh scripts/atlas-accrue.sh > /dev/null 2>&1 &
#   stop:   pkill -f atlas-accrue
export PATH=/Users/supahotthanos/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export SEO_BOT_CDP_ENDPOINT=${SEO_BOT_CDP_ENDPOINT:-http://localhost:9222}
cd /Users/supahotthanos/seo-bot || exit 1
CLIENT="${1:-nobsmedspareviews}"
CITIES="${2:-12}"
INTERVAL="${ATLAS_INTERVAL_S:-23400}"
mkdir -p logs
while true; do
  TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
  echo "[$TS] atlas-accrue: attempting run" >> logs/atlas-accrue.log
  node bin/seo-bot.mjs fanout-atlas "$CLIENT" --cities "$CITIES" >> logs/atlas-accrue.log 2>&1
  RC=$?
  echo "[$TS] atlas-accrue: rc=$RC — sleeping ${INTERVAL}s" >> logs/atlas-accrue.log
  sleep "$INTERVAL"
done
