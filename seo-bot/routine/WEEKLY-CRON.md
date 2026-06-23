# Weekly autonomous SEO cron — setup

The bot's `weekly` routine = read-loop (audit + measure) → **verifier-consensus autopilot**
(opens PRs for approved changes) → **daily brief**. It runs on the Claude Code subscription
(no API key) — so it must run **in an authenticated shell** (where `claude` is logged in), so
the verifier panel can convene. The `--push` opens PRs; prod only changes when a PR merges
(turn on auto-merge for the `seo-bot/` branch if you want it hands-off).

```
node seo-bot/bin/seo-bot.mjs weekly nobsmedspareviews --push
```

> Note: the in-session `CronCreate` scheduler is session-only and auto-expires in 7 days — use
> it for testing, but set ONE of the OS-level options below for a permanent weekly cron.

## Windows (Task Scheduler) — run on the box where you're logged into Claude Code
```powershell
schtasks /create /tn "seo-bot-weekly" /sc weekly /d MON /st 08:07 ^
  /tr "cmd /c cd /d C:\Users\shubh\Desktop\medspadirectory && node seo-bot\bin\seo-bot.mjs weekly nobsmedspareviews --push >> seo-bot\routine\weekly.log 2>&1"
```

## macOS / Linux (cron) — e.g. the Mac Mini, logged into claude
```cron
7 8 * * 1  cd /path/to/medspadirectory && /usr/local/bin/node seo-bot/bin/seo-bot.mjs weekly nobsmedspareviews --push >> seo-bot/routine/weekly.log 2>&1
```

## Multiple clients / portfolio
Run `weekly <client> --push` per client, then `brief` (no client) for the founders' roll-up:
```
for c in nobsmedspareviews client2 client3; do node seo-bot/bin/seo-bot.mjs weekly "$c" --push; done
node seo-bot/bin/seo-bot.mjs brief        # portfolio digest → seo-bot/reports/portfolio-brief.md
```
Set `SEO_BRIEF_WEBHOOK` (Slack/Discord/Zapier incoming webhook) to push the brief to your team.

## Why weekly (the two clocks)
You **publish/act weekly**, but you **judge on a lag** (Google ranking settles in 4–12 weeks;
AEO/Bing in days–weeks; decay at ~90 days). The autopilot already respects this: in
conservative mode it only scales a change-class with a *proven non-negative* history; in
aggressive mode the verifier consensus + change-ledger + CI gate are the safety net. So a
weekly cadence ships steadily while only *committing* to what the data has matured enough to
prove.

## To make it actually push (vs queue everything)
1. `connect nobsmedspareviews` — Google OAuth (adds the traffic-tier protection on money pages).
2. `cms.type: "nextjs"` — already set (PRs, not live overwrite).
3. `autopilot.mode: "aggressive"` — already set (push everything the verifiers approve).
4. Name the medical reviewer in `cfg.reviewers` — only needed for YMYL *content publishing*,
   not for the structural on-page autopilot.
5. Run the cron from an authenticated `claude` shell.
