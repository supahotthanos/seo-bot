#!/bin/zsh
# seo-bot · mini-install-agents — (re)install the full launchd fleet on the Mac Mini.
# Idempotent: bootout-if-loaded → copy plist → bootstrap → enable. Run ON the Mini:
#   zsh ~/seo-bot/scripts/mini-install-agents.sh
#
# Fleet: weekly (Sun 10:00) · daily (09:15) · intake (30 min) · qb-accrue (KeepAlive)
#        serp-accrue (KeepAlive). cdp-chrome is NOT touched (already loaded, owns the browser).
set -u
BOT="$HOME/seo-bot"
SRC="$BOT/scripts/launchd"
DST="$HOME/Library/LaunchAgents"
UID_N=$(id -u)
mkdir -p "$DST" "$BOT/logs"

# The accrue loops used to run as nohup'd shells — kill those so the supervised
# launchd instances are the ONLY copies (double loops would double the capture rate
# and trip the throttles the pacing is tuned around).
pkill -f 'scripts/query-bank-accrue.sh' 2>/dev/null && echo "· stopped manual query-bank-accrue"
pkill -f 'scripts/serp-accrue.sh' 2>/dev/null && echo "· stopped manual serp-accrue"

for name in weekly daily intake qb-accrue serp-accrue; do
  label="digital.cnai.seenai.$name"
  plist="$SRC/$label.plist"
  [ -f "$plist" ] || { echo "!! missing $plist"; continue; }
  launchctl bootout "gui/$UID_N/$label" 2>/dev/null || true
  cp "$plist" "$DST/$label.plist"
  launchctl bootstrap "gui/$UID_N" "$DST/$label.plist" && echo "✓ $label loaded" || echo "!! $label failed to bootstrap"
  launchctl enable "gui/$UID_N/$label" 2>/dev/null || true
done

echo "\n— loaded seenai agents —"
launchctl list | grep -i seenai || true
echo "\nHeartbeats land in $BOT/reports/_heartbeat/ · logs in $BOT/logs/"
