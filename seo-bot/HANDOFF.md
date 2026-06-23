# seo-bot — full handoff (for the Seenai dev team)

You build the client sites (Next.js, with Claude Code). **seo-bot** is the autonomous SEO/AEO
engine that audits, generates, optimizes, and *pushes PRs* to those sites — plus it tells you
where AI is citing competitors so the off-site team knows what to chase. This is everything in
one page. The bot is `seo-bot/` in this repo; it's plug-and-play per client via a JSON config.

> **Runs on the Claude Code subscription — no API key.** All model calls (content, fix
> rewrites, the verifier panel) go through the `claude` CLI in headless mode, so you just need
> to be **logged into `claude`** in whatever shell runs it. (`src/llm.mjs`.)

---

## 1. Quick start
```bash
node seo-bot/bin/seo-bot.mjs help            # every command
node seo-bot/bin/seo-bot.mjs list            # configured clients
node seo-bot/bin/seo-bot.mjs audit <client>  # crawl + score, write a report
node seo-bot/bin/seo-bot.mjs test            # the bot's own test suite (must stay green)
```
A client = `seo-bot/config/<name>.json` (copy `example.client.json`). The med-spa directory
data the generator uses is `data/all-spas.json`.

## 2. Command map
**Audit / diagnose (read-only, safe anywhere):** `audit` · `techaudit` (BFS depth, redirect
chains, X-Robots, orphans) · `schema` · `a11y` · `images` · `cro` · `cwv` (Core Web Vitals +
template fix-plan) · `opps` (GSC striking-distance + cannibalization) · `decay` (refresh queue)
· `links` (internal-link PageRank) · `updates` (Google algo monitor) · `crawlbots`.

**Generate (writes review artifacts, never auto-publishes):** `generate <client>` → "Best Med
Spas in [City]" listicle + city-stats + comparison pages from real data, index-gated. Output →
`reports/<client>/generated/` for review, then publish via `apply`.

**Autonomy:** `autopilot <client> [--push]` (propose → policy → **verifier consensus** → push
PRs) · `weekly <client> [--push]` (the cron target: read-loop → autopilot → brief) ·
`brief [client]` (daily/weekly oversight digest; portfolio if no client) · `gate <client>`
(CI regression gate, exit 10).

**Migration:** `migrate <client> --old <sitemap|urls|old-base> [--new <sitemap>]` (see §5).

**AI visibility / rank (run on the Mac — see §6):** `measure` · `serp` · `geogrid` ·
`sources` (what AI cites most → off-site worklist).

**Connect / apply:** `connect <client>` (Google OAuth) · `apply <client> [--yes]` · `dns` ·
`bing` · `inspect` · `gbp` · `clarity` · `entity`.

## 3. The autonomous loop + what's human-gated
`weekly --push` runs every week: it audits, measures AI visibility, proposes fixes, and the
**autopilot** pushes the safe ones. "Safe" = it clears the **verifier consensus** — N
independent adversarial model reviewers (on the subscription) must *unanimously* agree the
change is safe. Only then it opens a **Next.js PR** (never a live overwrite), journaled to the
change-ledger for one-click rollback. Prod changes only when the PR merges → **turn on
auto-merge for the `seo-bot/` branch** for hands-off, or review the PRs.

- `cfg.autopilot.mode: "aggressive"` → *any* auto-applicable structural fix flows to the
  verifier (not just meta/title). `"conservative"` → only proven meta/title clamps.
- **Always hard-gated to a human (never relax):** fake reviews / FTC, YMYL/medical claims +
  GLP-1 drug names, high-traffic/revenue pages, home/pricing/book/consult paths, and all
  irreversible actions (301/disavow/delete/noindex). Content publishing (new pages) needs a
  named reviewer in `cfg.reviewers` + a human approve.
- **The daily brief** (`brief`) shows every change (🤖 consensus vs 👤 human), ⚠ "might be
  wrong" flags, rollback pointers, **and the AI source map** — set `SEO_BRIEF_WEBHOOK` to push
  it to Slack/Discord.

## 4. How the bot plugs into a client's Next.js site (your build)
- `cms: { type: "nextjs", repoPath: ".", branchPrefix: "seo-bot/" }` in the client config →
  `apply`/`autopilot` open PRs on that repo's branch. (Other adapters: `edge`,
  `cloudflare-worker` for `<head>` injection on any stack; `wordpress` REST. Autopilot only
  uses PR/diff adapters.)
- The bot writes meta/title/canonical/robots/JSON-LD, internal links, alt text, answer
  capsules — keep those server-rendered (AI crawlers don't run JS).
- Apply the **CWV template fix-plan** (`cwv <client>` → `reports/<client>/cwv-template-*.md`)
  ONCE at the template: preload + `fetchpriority` on the LCP element, `next/image`, width/
  height, defer 3p JS. One lean template makes every generated page pass.

## 5. Migration onboarding (old domain, old site → new site we built) — YOUR workflow
This is the most common client and the #1 way to tank a domain if done wrong. **Before you
launch a rebuilt site:**
```bash
node seo-bot/bin/seo-bot.mjs migrate <client> --old <old-sitemap.xml | urls.txt | old-base-url> --new <new-sitemap.xml>
```
It auto-maps every OLD url → best NEW url and writes to `reports/<client>/migration/`:
- **`redirect-map.csv`** + ready-to-drop-in configs: **`vercel.json`**, **`next.config.redirects.js`**, `_redirects`, `.htaccess`.
- **`MIGRATION-HANDOFF.md`** — the launch checklist (pre-launch / launch / post-launch), with
  a **manual-mapping table** for low-confidence URLs and high-value pages flagged.

Rules: never blanket-redirect to the homepage (soft-404, loses equity); deploy the redirects
*with* the new site; keep them single-hop 301s (`techaudit` verifies); watch GSC for 404 spikes
for 2–4 weeks; re-point internal links. **Map the ⚠ manual rows by hand before launch.**

## 6. AI-visibility + rank tracking (run on the Mac Mini, residential IP)
Browser automation measures how the brand shows up the way real users see it — **no API, no
login** (the Peec-AI approach). Engines (set in `cfg.engines`): `chatgpt_free` (logged-OUT
chatgpt.com), `google_aimode` (Google AI Mode, `udm=50`), `google_aio` (AI Overviews),
`perplexity`, `google_organic` (top-20 organic + our position).
```bash
# on the Mac, once:  npm i patchright && npx patchright install chromium   (falls back to playwright)
node seo-bot/bin/seo-bot.mjs discover <client> --write  # build THIS client's prompt panel (see below)
node seo-bot/bin/seo-bot.mjs measure  <client>          # captures answers + cited sources per engine
node seo-bot/bin/seo-bot.mjs sources  <client>          # → what AI cites most + off-site worklist
node seo-bot/bin/seo-bot.mjs serp     <client>          # organic rank + SERP-feature inventory
node seo-bot/bin/seo-bot.mjs geogrid  <client> --kw "med spa"   # local map-pack grid
```
**Each client's bot finds its OWN prompts** — `discover` builds the panel from that business's
services × locations × brand × competitors, then adds real GSC demand + natural patient phrasing
(on the subscription). Not a generic "best med spas". `--write` saves it as the client's
`promptPanel`, which `measure`/`serp` then track.

The cited-source map + off-site worklist land in the **daily brief** automatically → that's what
the off-site team chases (get listed/mentioned/reviewed on the sources AI already trusts).

**Does the automation skew results? No** — ChatGPT/Google answer from your published HTML, not
from who's asking. The only real skews (both handled): **(a) geo** — every Google engine is
`&uule`-pinned to `cfg.location` so results aren't biased to the Mac's IP city (set 2–5 cities for
multi-market brands); **(b) detection** — a bot-challenge/consent wall would otherwise be misread
as "not mentioned", so blocked sessions are detected, marked `status:blocked`, and **excluded
from the %s** (a genuinely-absent AIO stays a real 0). Keep volume modest; `HEADFUL=1` helps the
interactive apps; selectors drift — expect occasional tweaks. Full rationale +
what-publicly-drives-each-engine: `research/ai-observation-stealth-2026.md`.

## 7. Per-client config (the JSON)
Key fields: `name`, `brand`, `domain`, `baseUrl`, `sitemaps`, `competitors`, `vertical`
("medspa" enables YMYL guards), `cms` (apply adapter), `engines` (AI-visibility), `promptPanel`
(the queries to track), `autopilot.mode`, `riskTiers` (auto-apply ceilings + high-risk paths),
`reviewers` (named medical reviewers — required to publish YMYL content), `gate` (CI thresholds),
`brief.webhook`, `spaDataFile` (default `data/all-spas.json`).

## 8. Go-live checklist (per client)
1. `node seo-bot/bin/seo-bot.mjs doctor <client>` — what's configured vs missing.
2. `connect <client>` — Google OAuth (adds traffic-tier protection on money pages).
3. `cms.type: "nextjs"` + repoPath → PRs.
4. `autopilot.mode: "aggressive"`, `vertical: "medspa"`, set `reviewers`.
5. Schedule the weekly cron (`seo-bot/routine/WEEKLY-CRON.md`) from an **authenticated `claude`
   shell**; enable auto-merge for the `seo-bot/` branch if you want it hands-off.
6. (Rebuild client?) Run `migrate` BEFORE launch.

## 9. Ground rules
- Never bypass the change-ledger (every write journals a before-value).
- Autopilot uses PR/diff adapters only — never a live overwrite.
- The legal/YMYL/irreversible gates are fail-closed — don't weaken them.
- Honor the core-update freeze (the loop pauses itself during Google volatility).
- Scraping/browser-automation runs on the Mac Mini (residential IP), never a datacenter box.
- `node seo-bot/bin/seo-bot.mjs test` must stay green before any merge.
