# QUICKSTART — fresh laptop → fully autonomous in ~15 minutes

This is the end-to-end path for a **new person on a new machine**. Every step is copy-paste.
(SETUP.md is the deeper runbook — OAuth internals, DNS connector, med-spa config details.)

## 0. Prerequisites (5 min)

- **Node 18+** (`node -v`) and **git**
- **Repo access** — this repo is private; ask the owner to add you as a collaborator on
  `supahotthanos/seo-bot-standalone`
- **A model for drafting/verifying** (one of):
  - the **Claude Code CLI** logged in (`claude` → sign in once) — no API key needed, or
  - `ANTHROPIC_API_KEY` set in your environment
  - *(neither present? Everything still runs — LLM-assisted steps queue for a human instead. Fail-closed by design.)*

## 1. Install

```bash
git clone https://github.com/supahotthanos/seo-bot-standalone.git seo-bot
cd seo-bot
npm install                        # one required dep (cheerio); optional ones are graceful
npx playwright install chromium    # optional: enables AI-visibility measurement (measure/serp)
node bin/seo-bot.mjs test          # 1027+ checks — proves your machine is good
```

## 2. Onboard your site (one command)

```bash
node bin/seo-bot.mjs setup yoursite.com
```

This detects your DNS/stack/booking setup, runs a baseline audit, and writes a starter
config to `config/yoursite-com.json`. Then open that file and fill in the essentials:

- `brand`, `city`, `services[]` (with **real prices** — the content gates refuse empty data)
- `vertical: "medspa"` if applicable (enables the 14-rule med-spa pack + YMYL legal gates)
- `promptPanel` — the AI-search prompts you want to be the answer for (start with 10, grow to 30–50)

Then let the bot tell you what's still missing:

```bash
node bin/seo-bot.mjs doctor yoursite-com   # every gap, with the exact fix for each
```

## 3. Connect Google (optional but recommended, ~5 min)

Unlocks Search Console + GA4 + Business Profile data (better decisions, real stats):

```bash
node bin/seo-bot.mjs connect yoursite-com   # one-click OAuth in your browser
```

First time ever on this Google Cloud project? Follow **SETUP.md §1** (5 min, one-time)
to create the OAuth client.

## 4. First run

```bash
node bin/seo-bot.mjs run yoursite-com       # full read-only loop: audit → propose → measure → score
node bin/seo-bot.mjs dashboard yoursite-com # publish results to the dashboard
```

Nothing touches your live site here — proposals queue for review.

## 5. Go autonomous (the point of all this)

```bash
node bin/seo-bot.mjs schedule install       # registers two Windows Scheduled Tasks
node bin/seo-bot.mjs schedule status        # verify: next runs + last heartbeat
```

- **Daily 09:15** — AI-visibility measurement, content-decay scan, dashboard sync
- **Weekly Sunday 10:00** — full routine: audit → propose → verifier-consensus autopilot → brief
- Laptop asleep at run time? **Missed runs fire on wake.**
- Custom times: `schedule install --daily 08:00 --weekly "SAT 09:00"` · undo: `schedule remove`
- **Mac/Linux:** no Task Scheduler — cron the same target instead:
  `15 9 * * * cd ~/seo-bot && node bin/seo-bot.mjs schedule run --kind daily`
  `0 10 * * 0 cd ~/seo-bot && node bin/seo-bot.mjs schedule run --kind weekly`

## What auto-applies vs. what waits for you (the safety model)

- **Auto (weekly, only if you opt in):** set `"autopilot": { "push": true }` in the client config.
  Even then: policy-gated + **3 independent adversarial verifiers must unanimously agree** +
  PR-only (never live-overwrite) + journaled for one-click `rollback`. Default is **off** —
  everything queues.
- **Always human-gated, no override:** content publishing (YMYL), anything legal-sensitive
  (reviews / before-after / health claims), index/redirect changes, off-site submissions.
- Your daily involvement: open the dashboard, approve/reject the queue. That's it.

## Dashboard — two options

1. **Join the hosted one** (easiest): ask the owner for an org invite on the SeenAI dashboard,
   then pair your laptop: `npx seenai-runner` (scrypt pairing; the runner can only run
   sync/weekly/first-audit — it can never push code or pass `--yes`).
2. **Run your own:** clone `supahotthanos/seenai-next`, `npm install && npm run dev`,
   point it at your `reports/` (see that repo's README).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `doctor` lists missing keys | each line includes the exact env var / config field to set |
| `measure` gets bot-blocked | run from a **residential IP** (home Wi-Fi, not a VPS/VPN) |
| LLM steps say "queued for human" | log in the `claude` CLI or set `ANTHROPIC_API_KEY` — fail-closed is intentional |
| `schedule install` errors | it never needs admin; check `schtasks` isn't blocked by IT policy |
| anything else | `node bin/seo-bot.mjs test` — 1027+ checks isolate what broke |
