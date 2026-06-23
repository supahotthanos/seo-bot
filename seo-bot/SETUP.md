# seo-bot — go-live runbook (the only manual steps left)

The bot is built and self-verifying. These are the **one-time** steps to take it live on a
real client. Run `node seo-bot/bin/seo-bot.mjs doctor` at any point — it tells you exactly
what's still missing, with the fix for each.

## 1. Google OAuth client (one-time, ~5 min) — unlocks one-click `connect`

This is the single most important step (GA4 + GSC + Business Profile all use it).

1. Go to **console.cloud.google.com** → create a project (e.g. "cnai-seo-bot").
2. **APIs & Services → Enable APIs**: enable **Google Analytics Data API**, **Search Console API**, **Business Profile API** (the last is approval-gated — submit the access request now; ~7–10 business days).
3. **APIs & Services → OAuth consent screen**: User type **External**; app name "seo-bot"; add `founders@cnai.digital` as a test user. **Then click "Publish app" → In production** (in Testing mode refresh tokens die after 7 days).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID → Application type: Desktop app.** Copy the **client ID** and **client secret**.
5. Set them (either works):
   ```bash
   export GOOGLE_OAUTH_CLIENT_ID="...apps.googleusercontent.com"
   export GOOGLE_OAUTH_CLIENT_SECRET="..."
   ```
   …or create `seo-bot/config/google-oauth.json`:
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

## 3. Bring on a client (one command + connect)

```bash
node seo-bot/bin/seo-bot.mjs setup yourclient.com        # onboard → config → worksheet → citations → content plan → verify
node seo-bot/bin/seo-bot.mjs connect yourclient-com      # sign in once as founders@cnai.digital, approve
```
Then finish the config (`seo-bot/config/yourclient-com.json`): set `ga4.propertyId`, `vertical: "medspa"`, `servicePathRe`, `locationPathRe`, `listings.canonicalNap`, `services[]` (with real prices), the YMYL reviewer, and expand `promptPanel` to 30–50 prompts. `doctor yourclient-com` lists anything missing.

## 4. Run the loop

```bash
node seo-bot/bin/seo-bot.mjs run     yourclient-com --apply --yes   # full pipeline; opens PRs for on-site fixes (you merge)
node seo-bot/bin/seo-bot.mjs content batch yourclient-com           # draft the content plan (gated); approve + publish what passes
node seo-bot/bin/seo-bot.mjs measure yourclient-com                 # capture AI-answer citations (no API)
node seo-bot/bin/seo-bot.mjs sources yourclient-com                 # off-site target worklist for the off-site team
node seo-bot/bin/seo-bot.mjs stats   yourclient-com                 # significance verdicts (needs ~weeks of GSC data)
node seo-bot/bin/seo-bot.mjs verify  yourclient-com                 # progress toward "perfect" (target ≥90)
```
The daily research routine and the weekly run+content task are already scheduled.

## What stays human (by design, not a gap)
- **Merging PRs** and **approving YMYL (medical) content** — auto-publishing medical/price claims is the client's legal liability (FTC/FDA). The bot drafts, gates, and stages everything; a human clicks approve + merge.
- **Off-site work** (claim GBP/Apple/Bing/directories, earn the mentions in the `sources` worklist) — relationship work the bot tees up but can't execute.
- **Time** — the stats engine can only render keep/revert verdicts after enough traffic accrues (weeks).
