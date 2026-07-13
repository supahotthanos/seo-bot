#!/bin/zsh
# seo-bot · mini-run — THE entry point launchd uses on the Mac Mini. Tracked in the repo
# (the old untracked copy vanished once; never again).
#
#   mini-run.sh weekly   Sun 10:00 — full weekly routine for EVERY real client config
#   mini-run.sh daily    09:15     — intake watch + pull founder decisions (apply as PRs) + lane health
#   mini-run.sh intake   every 30m — GSC-grant watcher alone (new client lands same half-hour)
#
# Design: iterates config/*.json so auto-onboarded clients join with zero edits here; loads
# .env (SEO_BOT_SECRET_KEY, SLACK_*); every failure ESCALATES to the C-suite Slack channel
# (escalate is best-effort and 24h-deduped — a dead Slack never fails a run, a flapping run
# never spams); heartbeats reports/_heartbeat/<mode> so staleness is checkable from anywhere.
set -u
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
BOT="$HOME/seo-bot"
cd "$BOT" || exit 1
if [ -f .env ]; then set -a; source .env; set +a; fi

MODE="${1:-weekly}"
mkdir -p logs reports/_heartbeat
LOG="logs/mini-$MODE.log"
STAMP() { date -u +%Y-%m-%dT%H:%M:%SZ; }
echo "[$(STAMP)] mini-run $MODE start" >> "$LOG"

# Real client configs only (infrastructure JSONs are not clients).
clients() {
  for f in config/*.json; do
    n="${f:t:r}"
    case "$n" in _e2e|example.client|google-oauth|source-trust) continue;; esac
    echo "$n"
  done
}

# fail <area> <title> — escalate with the log tail as detail (best-effort, never fatal).
fail() {
  node bin/seo-bot.mjs escalate --severity critical --area "$1" --title "$2" \
    --detail "$(tail -c 700 "$LOG" 2>/dev/null | tr '"' "'")" >> "$LOG" 2>&1 || true
}

case "$MODE" in
  weekly)
    for c in $(clients); do
      echo "[$(STAMP)] weekly $c" >> "$LOG"
      if ! node bin/seo-bot.mjs weekly "$c" --push >> "$LOG" 2>&1; then
        fail weekly "Weekly run FAILED on the Mini — $c"
      fi
    done
    ;;
  daily)
    # 1) new-client intake (the dev-granted-GSC lane)
    node bin/seo-bot.mjs intake watch >> "$LOG" 2>&1 || fail intake "Client intake watch FAILED on the Mini"
    # 2) founder decisions from the dashboard → PR applies (human already approved; PR-only adapters)
    for c in $(clients); do
      node bin/seo-bot.mjs dashboard "$c" --pull --apply --yes >> "$LOG" 2>&1 \
        || fail dashboard "Decision pull/apply FAILED — $c"
    done
    # 3) capture-lane health (quiet >24h → one escalation)
    node bin/seo-bot.mjs lane-health >> "$LOG" 2>&1 || true
    ;;
  intake)
    node bin/seo-bot.mjs intake watch >> "$LOG" 2>&1 || fail intake "Client intake watch FAILED on the Mini"
    ;;
  *)
    echo "usage: mini-run.sh {weekly|daily|intake}" >&2
    exit 2
    ;;
esac

STAMP > "reports/_heartbeat/$MODE"
echo "[$(STAMP)] mini-run $MODE done" >> "$LOG"
