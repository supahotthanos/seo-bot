# seo-bot — go-live runbook (the only manual steps left)

The bot is built and self-verifying. These are the **one-time** steps to take it live on a
real client. Run `node bin/seo-bot.mjs doctor` at any point — it tells you exactly
what's still missing, with the fix for each.

## 1. Google OAuth client (one-time, ~5 min) — unlocks one-click `connect`

This is the single most important step (GA4 + GSC + Business Profile all use it).

1. Go to **console.cloud.google.com** → create a project (e.g. "cnai-seo-bot").
2. **APIs & Services → Enable APIs**: enable **Google Analytics Data API**, **Search Console API**, **Business Profile API** (the last is approval-gated — submit the access request now; ~7–10 business days).
3. **APIs & Services → OAuth consent screen**: User type **External**; app name "seo-bot"; add `you@your-agency.com` as a test user. **Then click "Publish app" → In production** (in Testing mode refresh tokens die after 7 days).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID → Application type: Desktop app.** Copy the **client ID** and **client secret**.
5. Set them (either works):
   ```bash
   export GOOGLE_OAUTH_CLIENT_ID="...apps.googleusercontent.com"
   export GOOGLE_OAUTH_CLIENT_SECRET="..."
   ```
   …or create `config/google-oauth.json`:
   ```json
   { "client_id": "...apps.googleusercontent.com", "client_secret": "..." }
   ```
6. (Recommended) `export SEO_BOT_SECRET_KEY="<any long random string>"` — encrypts the stored refresh tokens at rest. After the consent screen is In-Production, set `connectorsProductionReady: true` in the client config.

## 2. Runtime keys

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # lets `content draft/batch` auto-write copy (gates apply regardless)
export INDEXNOW_KEY="..."               # optional: instant Bing/ChatGPT indexing (host {key}.txt at the domain root)
```
For `measure` (AI-visibility, no API), run from a **residential IP** so ChatGPT/Perplexity/Google don't bot-block, and once: `npx playwright install chromium`.

**DNS connector (optional, "access to all the DNS"):** create a Cloudflare API token (Zone:DNS:Edit on the client's zone) → `export CLOUDFLARE_API_TOKEN="..."`. Then `dns <client>` reads records, and `dns <client> --add-dmarc --yes` / `--verify-google <token> --yes` writes the DMARC + verification records the onboarding step flags (write-gated behind `--yes`).

**Slack lanes (optional, ~3 min):** two lanes, one bot. **#approvals** gets the queue mirror — every `dashboard push` posts high-urgency (red-tier) changes, each with a one-click deep link to the dashboard card (`…/approvals?client=<c>&focus=<taskId>`) where before/after screenshots + accept/reject live, plus held YMYL blog PRs. **#c-suite** gets BIG issues only (weekly-run failures, content-guardrail trips, dead capture lanes, new-client intake events; 24h dedupe — no spam).

*Recommended transport — a dedicated bot (posts as "SeenAI", named channels, revocable independently of your other integrations):*
1. **api.slack.com/apps → Create New App → From an app manifest** → pick the workspace → paste `scripts/slack-app-manifest.json` → Create.
2. **Install to Workspace** → copy the **Bot User OAuth Token** (`xoxb-…`) from *OAuth & Permissions*.
3. In each PRIVATE channel the bot should post to (e.g. your C-suite channel): `/invite @seenai`. Public channels need no invite (`chat:write.public`).
4. Channel IDs: channel name → *View channel details* → bottom of the About tab → **copy Channel ID** (`C0…`).
5. Set env wherever the bot runs (laptop `.env` AND the Mini's `~/seo-bot/.env`):
   ```bash
   SLACK_BOT_TOKEN="xoxb-…"
   SEO_BOT_SLACK_CHANNEL_CSUITE="C0…"      # big issues
   SEO_BOT_SLACK_CHANNEL_APPROVALS="C0…"   # queue mirror (may be the same channel)
   ```
6. Verify end-to-end: `node bin/seo-bot.mjs slack-test` (exit 0 = a message landed).

*Fallback transport:* a plain incoming webhook still works (`SEO_BOT_SLACK_WEBHOOK="https://hooks.slack.com/services/…"`) — single channel, used only when no bot token is set. No transport at all = the lanes are silently off; the dashboard queue remains the source of truth.

**Zero-click client intake — THE HANDOFF PROTOCOL (3 lanes, all on the Mini's 30-min watcher):** when your web-dev finishes a site he does exactly two things: ① adds `your-agency@example.com` as a user in the site's **Search Console**, ② invites the **your-agency-account GitHub account** as a collaborator on the site's repo. The watcher does the rest — no clicks from anyone:
- **gsc lane** — the grant appears in `sites.list` → domain onboarded (config + worksheet + citations + content plan), `gsc.siteUrl` set, shared token linked (pulls live immediately), 🆕 posted to C-suite. Grants need no acceptance; unverified properties are reported, never auto-onboarded.
- **github lane** — the invitation is ACCEPTED via the GitHub API (never an email link), the repo is cloned to `~/clients/`, and if the repo's name/homepage unambiguously matches a client domain it's paired automatically (`cms.repoPath` set → **the PR lane is live**: on-page fixes + blog posts flow as PRs). Ambiguous → C-suite gets a message with the one command to run: `intake pair <client> --repo <owner/name>`.
- **mail lane** — everything ELSE that lands in the inbox (hosting invites, credential handoffs, "site is live" notes) is surfaced to the C-suite channel with sender+subject. Read-only IMAP (EXAMINE + BODY.PEEK): the bot never clicks links, never replies, never marks read.

One-time setup:
```bash
# ① GSC consent (laptop, browser): sign in as your-agency@example.com, approve (GSC scope only)
node bin/seo-bot.mjs intake connect
scp secrets/_intake.google.json mini:seo-bot/secrets/

# ② GitHub: create/log into the your-agency-account GitHub account → Settings → Developer settings →
#    Personal access tokens → Tokens (classic) → scope: repo → copy ghp_…
#    (classic, not fine-grained — invitation accept needs it)  → on the Mini:
echo 'GH_TOKEN=ghp_…' >> ~/seo-bot/.env      # gh CLI honors it too (retires the device-auth blocker)

# ③ Gmail app password: Google account (your-agency-account) → Security → 2-Step Verification (turn ON)
#    → App passwords → generate → then on the Mini:
node bin/seo-bot.mjs intake gmail --app-password "xxxx xxxx xxxx xxxx" --test

node bin/seo-bot.mjs intake status           # shows all three lanes' readiness
```

## 3. Bring on a client (one command + connect)

```bash
node bin/seo-bot.mjs setup yourclient.com        # onboard → config → worksheet → citations → content plan → verify
node bin/seo-bot.mjs connect yourclient-com      # sign in once as you@your-agency.com, approve
```
Then finish the config (`config/yourclient-com.json`): set `ga4.propertyId`, `vertical: "medspa"`, `servicePathRe`, `locationPathRe`, `listings.canonicalNap`, `services[]` (with real prices), the YMYL reviewer, and expand `promptPanel` to 30–50 prompts. `doctor yourclient-com` lists anything missing.

## 4. Run the loop

```bash
node bin/seo-bot.mjs run     yourclient-com --apply --yes   # full pipeline; opens PRs for on-site fixes (you merge)
node bin/seo-bot.mjs content batch yourclient-com           # draft the content plan (gated); approve + publish what passes
node bin/seo-bot.mjs measure yourclient-com                 # capture AI-answer citations (no API)
node bin/seo-bot.mjs sources yourclient-com                 # off-site target worklist for the off-site team
node bin/seo-bot.mjs stats   yourclient-com                 # significance verdicts (needs ~weeks of GSC data)
node bin/seo-bot.mjs verify  yourclient-com                 # progress toward "perfect" (target ≥90)
```
The daily research routine and the weekly run+content task are already scheduled.

## What stays human (by design, not a gap)
- **Merging PRs** and **approving YMYL (medical) content** — auto-publishing medical/price claims is the client's legal liability (FTC/FDA). The bot drafts, gates, and stages everything; a human clicks approve + merge.
- **Off-site work** (claim GBP/Apple/Bing/directories, earn the mentions in the `sources` worklist) — relationship work the bot tees up but can't execute.
- **Time** — the stats engine can only render keep/revert verdicts after enough traffic accrues (weeks).
