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
# launchd starts with a bare PATH — every tool the engine or its drivers might exec
# (node/claude/gh/git/curl/python3) must be reachable here. Missing gh silently
# turned the gh-CLI store driver into a no-op (jobs poll saw "queue empty" while a
# real order sat in the store, 2026-07-13).
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
command -v gh >/dev/null 2>&1 || export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
BOT="$HOME/seo-bot"
cd "$BOT" || exit 1
if [ -f .env ]; then set -a; source .env; set +a; fi
# Panel dimensions: every lane this script spawns stamps its capture seat + auth state
# (fresh process per tick, so this takes effect on the next tick — no restarts needed).
export SEO_BOT_VANTAGE="${SEO_BOT_VANTAGE:-mini}"
export SEO_BOT_AUTH_STATE="${SEO_BOT_AUTH_STATE:-logged-in}"

MODE="${1:-weekly}"
mkdir -p logs reports/_heartbeat
LOG="logs/mini-$MODE.log"
STAMP() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# ── MUTEX: one mini-run mode at a time (morning/weekly/daily/intake share the repo + git).
# A skipped tick is retried by the next one; nothing is ever lost, nothing ever collides.
# EXCEPTION: the jobs lane (pre-call audits) gets ITS OWN lock — call ammo must not wait
# behind a long weekly; it touches no git and no shared client state.
if [ "$MODE" = "jobs" ]; then LOCK=/tmp/seo-bot-jobs.lock; else LOCK=/tmp/seo-bot-minirun.lock; fi
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "[$(STAMP)] mini-run $MODE: another mode holds the lock — next tick retries" >> "$LOG"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

echo "[$(STAMP)] mini-run $MODE start" >> "$LOG"

# ── SELF-UPDATE (fleet deployment): fast-forward to origin/master, GATED by the suite. ──
# Ship flow: any session commits+pushes to the private remote → the next scheduled run here
# picks it up automatically. Safety: suite red after pull = hard rollback to the previous
# commit + escalation; a diverged tree (local commits not yet pushed) skips quietly — the
# morning routine pushes those and the next tick converges. Suite only runs on NEW commits.
if git fetch -q origin master 2>/dev/null; then
  PREV=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse origin/master 2>/dev/null || echo "$PREV")
  if [ "$PREV" != "$REMOTE" ]; then
    if git merge -q --ff-only origin/master 2>/dev/null; then
      echo "[$(STAMP)] self-update: $PREV -> $(git rev-parse --short HEAD), running suite gate" >> "$LOG"
      if node test/run.mjs > /tmp/mini-selfupdate-suite.log 2>&1; then
        echo "[$(STAMP)] self-update: suite GREEN — running on the new code" >> "$LOG"
      else
        git reset --hard "$PREV" >> "$LOG" 2>&1
        echo "[$(STAMP)] self-update: suite RED — ROLLED BACK to $PREV" >> "$LOG"
        node bin/seo-bot.mjs escalate --severity critical --area self-update \
          --title "Mini self-update ROLLED BACK — suite red after pull" \
          --detail "$(tail -c 500 /tmp/mini-selfupdate-suite.log 2>/dev/null | tr '"' "'")" >> "$LOG" 2>&1 || true
      fi
    else
      echo "[$(STAMP)] self-update: skipped (local commits diverge — morning push will converge)" >> "$LOG"
    fi
  fi
fi

# ── SCHEDULE GATES (interval-driven): launchd's StartCalendarInterval proved unreliable on
# this box (triggers registered + machine awake, runs=0 — morning & weekly never fired
# 2026-07-13). Every agent ticks on StartInterval and the SCRIPT decides when to run — the
# mechanism behind intake's 33-for-33 record. A missed window self-heals on the next tick.
# Gates come AFTER self-update ON PURPOSE (found 2026-07-20, off-LAN): when they came first,
# an off-window tick exited without pulling, so deploys rode ONLY on jobs+intake — and with
# those agents down, pushes sat undeployed for hours. Now every alive agent carries deploys.
case "$MODE" in
  morning)  # once per day, first tick at/after 09:00 local
    [ "$(date +%H)" -lt 9 ] && exit 0
    [ -n "$(find reports/_heartbeat/morning -newermt 'today 00:00' 2>/dev/null)" ] && exit 0
    ;;
  daily)    # once per day, first tick at/after 09:15 local
    { [ "$(date +%H)" -lt 9 ] || { [ "$(date +%H)" -eq 9 ] && [ "$(date +%M)" -lt 15 ]; }; } && exit 0
    [ -n "$(find reports/_heartbeat/daily -newermt 'today 00:00' 2>/dev/null)" ] && exit 0
    ;;
  weekly)   # Sundays, first tick at/after 10:00 local, once per week
    [ "$(date +%u)" != "7" ] && exit 0
    [ "$(date +%H)" -lt 10 ] && exit 0
    [ -n "$(find reports/_heartbeat/weekly -mtime -6 2>/dev/null)" ] && exit 0
    ;;
esac

# Real client configs only (infrastructure JSONs and *.local.json overlays are not clients).
clients() {
  for f in config/*.json; do
    case "$f" in *.local.json) continue;; esac
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
      # Monthly-gated FULL deep audit (founders+AI lane): live GBP/citation captures + a
      # regenerated action plan. Guard file keeps it to one run per ~30 days per client;
      # the weekly tick above already diffs/auto-verifies the plan in between. Never fatal.
      GUARD="reports/$c/.deep-audit-last"
      if [ ! -f "$GUARD" ] || [ -n "$(find "$GUARD" -mtime +30 2>/dev/null)" ]; then
        echo "[$(STAMP)] deep-audit (monthly) $c" >> "$LOG"
        if node bin/seo-bot.mjs deep-audit "$c" >> "$LOG" 2>&1; then
          touch "$GUARD"
        else
          fail deep-audit "Monthly deep audit FAILED on the Mini — $c"
        fi
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
    # 3.5) Rank-Loop flight check: the ONE system verdict (writes reports/_flight/latest.json;
    #      RED escalates to c-suite by itself). Never fatal to the tick.
    node bin/seo-bot.mjs flight-check >> "$LOG" 2>&1 || true
    # 4) panel mirrors (redundant with intake/jobs — change-guarded, at most one write each)
    SEO_BOT_EXPORT_VIA=daily node bin/seo-bot.mjs qb-export seenai >> "$LOG" 2>&1 || true
    SEO_BOT_EXPORT_VIA=daily node bin/seo-bot.mjs qb-export nobsmedspareviews >> "$LOG" 2>&1 || true
    ;;
  intake)
    node bin/seo-bot.mjs intake watch >> "$LOG" 2>&1 || fail intake "Client intake watch FAILED on the Mini"
    # panel mirrors ride EVERY self-updating lane (redundancy: whichever agent is alive exports;
    # the `via` tag in the store commit says WHICH — a remote lane-liveness probe for free).
    SEO_BOT_EXPORT_VIA=intake node bin/seo-bot.mjs qb-export seenai >> "$LOG" 2>&1 || true
    SEO_BOT_EXPORT_VIA=intake node bin/seo-bot.mjs qb-export nobsmedspareviews >> "$LOG" 2>&1 || true
    ;;
  jobs)
    # fast lane: pre-call audits for CONFIRMED leads (5-min tick, own lock, no gates)
    node bin/seo-bot.mjs jobs-poll >> "$LOG" 2>&1 || fail jobs "Jobs poll FAILED on the Mini"
    # panel mirror: qb panels → PRIVATE store, change-guarded (writes only when rows changed)
    # so the laptop can read the data from ANY network without ssh. Never fatal.
    SEO_BOT_EXPORT_VIA=jobs node bin/seo-bot.mjs qb-export seenai >> "$LOG" 2>&1 || true
    SEO_BOT_EXPORT_VIA=jobs node bin/seo-bot.mjs qb-export nobsmedspareviews >> "$LOG" 2>&1 || true
    ;;
  morning)
    # The 9 AM routine, fully deterministic — no Claude session required. Self-update above
    # already pulled the latest code, so this always runs the freshest engine.
    QB=$(wc -l < reports/query-bank/nobsmedspareviews/observations.ndjson 2>/dev/null | tr -d " " || echo 0)
    SR=$(wc -l < research/serp-playbook/nobsmedspareviews/serp-observations.ndjson 2>/dev/null | tr -d " " || echo 0)
    echo "[$(STAMP)] morning: overnight accrual qb=$QB serp=$SR" >> "$LOG"
    # Panel integrity BEFORE the voice rebuild: a cheap sonnet pass quarantines any junk rows
    # (throttle interstitials / UI fragments) so the corpus + deck stats build on verified data.
    # Best-effort: adjudication trouble must never block the morning push (it escalates itself).
    node bin/seo-bot.mjs qb-verify --max 60 >> "$LOG" 2>&1 || true
    node bin/seo-bot.mjs blog-corpus nobsmedspareviews >> "$LOG" 2>&1 || fail morning "Morning voice rebuild FAILED on the Mini"
    # The daily decision pass: claude headless reads the fresh artifacts and posts the
    # prioritized action memo to #c-suite. Best-effort — a mute strategist never blocks the push.
    node bin/seo-bot.mjs strategist >> "$LOG" 2>&1 || true
    # panel mirrors after the overnight accrual + verify pass (freshest possible snapshot)
    SEO_BOT_EXPORT_VIA=morning node bin/seo-bot.mjs qb-export seenai >> "$LOG" 2>&1 || true
    SEO_BOT_EXPORT_VIA=morning node bin/seo-bot.mjs qb-export nobsmedspareviews >> "$LOG" 2>&1 || true
    if [ -n "$(git status --porcelain research/ config/ 2>/dev/null)" ]; then
      git add research/ config/ >> "$LOG" 2>&1
      if git commit -q -m "corpus: overnight accrual $(date +%Y-%m-%d) — voice rebuilt" >> "$LOG" 2>&1; then
        git push -q origin master >> "$LOG" 2>&1 || fail morning "Morning corpus push FAILED — commits stranded on the Mini"
      fi
    fi
    if node test/run.mjs > /tmp/morning-suite.log 2>&1; then
      SUITE="suite green ($(grep -oE '[0-9]+ passed' /tmp/morning-suite.log | tail -1))"
    else
      SUITE="SUITE RED"
      fail morning "Morning suite RED on the Mini"
    fi
    node bin/seo-bot.mjs escalate --severity info --area nightly \
      --title "Morning push done — $(date +%Y-%m-%d)" \
      --detail "overnight: qb=$QB serp=$SR observations · corpus/voice rebuilt · $SUITE" >> "$LOG" 2>&1 || true
    ;;
  *)
    echo "usage: mini-run.sh {weekly|daily|intake}" >&2
    exit 2
    ;;
esac

STAMP > "reports/_heartbeat/$MODE"
echo "[$(STAMP)] mini-run $MODE done" >> "$LOG"
