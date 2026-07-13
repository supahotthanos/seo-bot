#!/bin/zsh
# seo-bot · GOOGLE SEO lane (operator order 2026-07-12: "be smart, don't get IP banned").
# Backend = a WARM PERSISTENT CHROME PROFILE (google-profile) — proven live it gets HTTP 200 + real
# organic results where Camoufox got Google's /sorry/ wall. A real browser with cookies + accepted
# consent is the trust signal Google wants; even logged-out it sails through. Still paced SLOW +
# LOW-VOLUME on one IP (a few SERPs/attempt, long gaps, hard cooldown on any /sorry/) — the profile
# self-warms across runs. Log into a Google account in google-profile for even more headroom.
# Deliberately does NOT set SEO_BOT_CDP_ENDPOINT — the Google lane launches its OWN Chrome (the warm
# profile via ignoreCdp), never touching the ChatGPT CDP Chrome.
#   start: nohup zsh scripts/serp-accrue.sh > /dev/null 2>&1 &
#   stop:  pkill -f serp-accrue
export PATH=/Users/supahotthanos/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
unset SEO_BOT_CDP_ENDPOINT
cd /Users/supahotthanos/seo-bot || exit 1
CLIENT="${1:-nobsmedspareviews}"
CITIES="${SERP_CITIES:-65}"            # cover the whole grid; the runner slices a few per attempt
MAXRUN="${SERP_MAX:-4}"                 # only 4 SERPs per attempt — the safe ceiling on one IP
INTERVAL="${SERP_INTERVAL_S:-2400}"     # 40 min between attempts (jittered by the runner's own pacing)
HARVEST="${SERP_HARVEST:-}"             # set SERP_HARVEST=--harvest to also pull winners' blogs
mkdir -p logs
while true; do
  TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
  echo "[$TS] serp-accrue: attempt (cities=$CITIES max=$MAXRUN, Camoufox stealth)" >> logs/serp-accrue.log
  node bin/seo-bot.mjs serp-radar "$CLIENT" --cities "$CITIES" --max "$MAXRUN" $HARVEST >> logs/serp-accrue.log 2>&1
  echo "[$TS] serp-accrue: rc=$? — sleeping ${INTERVAL}s" >> logs/serp-accrue.log
  sleep "$INTERVAL"
done
