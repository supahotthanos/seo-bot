#!/bin/zsh
# seo-bot · ChatGPT AEO WORKHORSE (operator order 2026-07-12: "ChatGPT never has issues, run it to
# the limit, don't stop"). Multi-tab concurrent query-bank capture on the logged-in ChatGPT session
# (temporary-chat, Instant/low tier). No IP-ban risk — the only ceiling is the $20 Plus message cap,
# which the runner detects and HALTS on politely, stamping a cooldown; this loop then waits it out
# and resumes. Runs the FULL market grid × the full money-query bank, accruing forever.
#   start: nohup zsh scripts/query-bank-accrue.sh > /dev/null 2>&1 &
#   stop:  pkill -f query-bank-accrue
export PATH=/Users/supahotthanos/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export SEO_BOT_CDP_ENDPOINT=${SEO_BOT_CDP_ENDPOINT:-http://localhost:9222}  # the logged-in ChatGPT Chrome
# Panel dimensions (2026-07-20, two-seat + auth-state era). NOTE: the running loop only picks
# these up on its next RESTART (pkill -f query-bank-accrue; relaunch) — until then Mini rows
# stay null-stamped, which the analytics reads as legacy-mini.
export SEO_BOT_VANTAGE=${SEO_BOT_VANTAGE:-mini}
export SEO_BOT_AUTH_STATE=${SEO_BOT_AUTH_STATE:-logged-in}
export SEO_BOT_CAPTURE_COOLDOWN_MS=${SEO_BOT_CAPTURE_COOLDOWN_MS:-5400000}  # 90 min — a chatgpt.com nav-throttle clears fast; a real cap re-stamps every 90 min until it lifts
cd /Users/supahotthanos/seo-bot || exit 1
CLIENT="${1:-nobsmedspareviews}"
# PRESSURE DIAL-DOWN (Shubh 2026-07-17: "we're hitting the request thing too often — you're
# wasting"). The 2026-07-12 "run it to the limit" order is superseded: walls were landing daily,
# and a walled pass burns budget for zero rows. Half the per-pass load, double the spacing,
# gentler bursts — accrual is a marathon; the account cap is the track, not the finish line.
CONCURRENCY="${QB_CONCURRENCY:-2}"     # 2 tabs (also the Mini's RAM sweet spot)
MAXRUN="${QB_MAX:-16}"                  # cells per attempt; a real cap-halt ends it early anyway
INTERVAL="${QB_INTERVAL_S:-2400}"       # 40 min between attempts; cooldown gate no-ops capped runs
mkdir -p logs
while true; do
  TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
  echo "[$TS] query-bank-accrue: attempt (concurrency=$CONCURRENCY max=$MAXRUN tier=low)" >> logs/query-bank-accrue.log
  # Keep the profile's cookies under the 431 header-size limit (bloat = every new tab 431s).
  node scripts/trim-cookies.mjs >> logs/query-bank-accrue.log 2>&1
  node bin/seo-bot.mjs query-bank "$CLIENT" --tiers low --concurrency "$CONCURRENCY" --max "$MAXRUN" >> logs/query-bank-accrue.log 2>&1
  echo "[$TS] query-bank-accrue: rc=$? — sleeping ${INTERVAL}s" >> logs/query-bank-accrue.log
  sleep "$INTERVAL"
done
