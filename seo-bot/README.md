# seo-bot — plug-and-play SEO/AEO executor

An in-house, near-zero-cost SEO/AEO agent for **sites you own the DNS for**. It
audits a site the way AI answer engines actually see it (raw HTML, no JS),
proposes concrete fixes, applies them through the site's CMS behind a human-approval
gate, verifies the fix is server-rendered, pings IndexNow, and tracks AI-answer
visibility over time.

> **Why this beats buying OTTO/SearchAtlas:** OTTO's default delivery is a
> client-side JS pixel that mutates the DOM after load — and AI crawlers
> (GPTBot/ClaudeBot/PerplexityBot) don't run JS, so they never see those changes.
> Because **we control the source**, seo-bot writes the *same* fixes into
> server-rendered HTML, which is strictly better for both Google and AI engines,
> at $0 in SaaS fees. See `../research/inhouse-seo-engine-plan.md` for the full rationale.

## Zero new dependencies

Pure Node ESM + `cheerio` (already in the repo). Runs with plain `node` — no build
step, no `tsx`, no extra installs. Optional, graceful enhancers:
`ANTHROPIC_API_KEY` (better fix drafting), `GSC_CREDENTIALS` (Search Console data),
`INDEXNOW_KEY` (instant Bing/ChatGPT indexing), Playwright chromium (AI-visibility tracking).

## Command reference (`node seo-bot/bin/seo-bot.mjs <cmd>`)

**Onboard a client**
```
connect  <client> [--force]        one-click Google OAuth (GA4+GSC+GBP); PKCE + encrypted tokens
ga4      <client>                   pull GA4 sessions/conversions + AI-referral sessions
onboard  <domain> [--write-config]  DNS + stack + booking detect + baseline audit + starter config
worksheet <client>                  the full "bring on a client" sheet (everything combined)
citations <client>                  local-listings worklist (GBP/Apple/Bing/Boulevard/aggregators/dirs)
```
**Optimize on-site**
```
audit    <client> [--max N]         crawl raw HTML + run rules (incl. med-spa pack) -> report
propose  <client>                   audit -> concrete fix proposals (LLM-assisted, slop-resistant)
apply    <client> [--yes]           apply proposals via the CMS adapter (nextjs PR / wordpress REST)
run      <client> [--apply --yes] [--no-measure]   THE FULL PIPELINE: pull->audit->decide->apply->
                                    verify->indexnow->measure->sources->progress-score
```
**Content (data-grounded, anti-slop, YMYL one-click-approve)**
```
content plan    <client>            service x geo plan (Sturm compact-keyword grid + blogs)
content draft   <client> "<topic>"  brief-grounded draft (refuses on empty data table)
content score   <client> <file>     run the hard+soft gates on a draft
content approve <client> <slug>      human one-click approve (refuses unless publish-eligible)
content publish <client> [--yes]     open a Next.js PR with approved+gated drafts (human merges)
```
**Measure, decide, research**
```
measure  <client>                   AI-visibility tracking (no API; drives the real chat apps)
sources  <client>                   rank what AI engines cite most -> off-site target worklist (no API)
stats    <client>                   statistical-significance scan over GSC (only act when real)
verify   <client>                   score 0-100 toward "perfect" (definition-of-done rubric) + gaps
tactics  [client]                   white/grey/black ranking levers, risk-labeled
research {tweet|fetch|score} ...     credibility-scored source ingestion (Scrapling stealth)
```

## Med-spa mode + the recurring cadence

Set `"vertical": "medspa"` (+ `servicePathRe`, `locationPathRe`) in a client config to enable the
14-rule med-spa pack (MedicalBusiness schema, NAP, per-service Offer pricing, YMYL E-E-A-T,
booking/Reserve action, and **flag-only** legal rules for reviews/before-after/GLP-1/health-claims).
See `../research/medspa-seo-framework.md`.

The operation runs on this cadence (reuse the scheduled-task runner):

| When | Command | What |
|---|---|---|
| **Per new site** | `onboard <domain> --write-config` → `citations <client>` | DNS/stack/baseline + canonical-NAP capture + the tiered citations worklist |
| **Daily** | the `seo-aeo-daily-research` routine | study top operators (Gabe, Hawkins, Solis, King…), tier+corroborate claims, propose rule deltas (human-gated) |
| **Weekly** | `run <client>` (+`--apply --yes` for auto-fixes) | re-audit (incl. med-spa pack), verify server-render, measure AI visibility, drift-diff vs onboarding baseline |
| **Monthly** | `citations <client>` | NAP-consistency check, re-verify Reserve-with-Google "Book" button, review-policy compliance watch |
| **Post core-update** | `run` across all clients | E-E-A-T battery (Gabe's principle) when the daily routine confirms a core update |

Off-site actions are flag-and-track (human submits); on-site fixes auto-apply through the gated
adapters; legal-sensitive med-spa rules never auto-edit.

## Change only when it's statistically real

`src/stats/` is the data-driven controller behind "only change things that move the number."
A change is judged with a **two-proportion z-test** on CTR/conversion, **gated on a minimum
sample** (detecting a 10%→11% CTR lift needs ~14.7k impressions/arm — thin data can't judge),
on a **locked horizon** (judge once, no peeking — peeking inflates false positives 5%→30-40%),
under **Benjamini-Hochberg FDR** across the batch, with **difference-in-differences vs control
pages** to subtract a core-update/seasonality tide, a **≥5% practical-effect floor**, and a
**guardrail override** (a CTR "win" that tanks bookings → revert). Verdict is four-way:
`keep / revert / try-next / insufficient-data` (+ `hold` during a confirmed core update).
`try-next` — powered, horizon met, no effect — is the "change something" trigger.

**Why not a 10-minute loop:** you cannot measure significance on minutes of data, and re-judging
a fixed-horizon test every tick *is* the peeking failure. So stats **decide weekly at locked
horizons**, not on a wall clock. Research stays daily; only the decision cadence is data-paced.

## Ranking levers — the full spectrum, risk-labeled

`tactics` lists every white/grey/black lever with hat · penalty risk · evidence · routing:
🟢 auto (bot applies) · 🟡 flag-opt-in (you flip on per-tactic via `tacticsOptIn[]`) · ✋ manual
(off-site) · ⛔ do-not-automate (penalty/illegal — knowledge only). Manipulation operators
(e.g. **Jacky Chou** / BrowserBlast) are tracked as **ADVERSARIAL_SIGNAL** (intel about what's
being sold) but quarantined below the trust threshold so their tactics can never auto-apply;
fake reviews are a hard legal block regardless of measured lift.

Reports land in `seo-bot/reports/<client>/` (`latest.md`, `proposals-latest.md`, `run-latest.json`).

## Deploy to a NEW site you own (4 steps)

1. `cp seo-bot/config/example.client.json seo-bot/config/<name>.json`
2. Set `brand`, `domain`, `baseUrl`, `competitors`, `schemaTypesExpected`, `promptPanel`.
3. Pick the `cms.type`:
   - `dryrun` — report only (safe default; start here on every site).
   - `nextjs` — set `repoPath` to the client's Next.js repo; fixes land on a branch + PR.
   - `wordpress` — set `wpBaseUrl`/`wpUser`/`wpAppPassword` (or `ENV:` indirections); fixes via WP REST API.
4. `node seo-bot/bin/seo-bot.mjs audit <name>` → review → `run <name> --apply --yes`.

That's the plug-and-play promise: the bot is identical across sites; only the config and the CMS adapter differ.

## The loop (what `run` does)

```
① pull     GSC (free) — queries, positions, CTR, + the new AI-search rows  → prioritization
② audit    crawl sitemap, fetch RAW HTML, run every rule (see below)       → findings + score
③ decide   turn findings + GSC opportunity into concrete fix proposals     → proposals-*.md
④ apply    write fixes via the CMS adapter (gated by --yes; never auto-merge)
⑤ verify   re-fetch the live URL as raw HTML — confirm the fix is server-rendered (beats OTTO's pixel)
⑥ indexnow submit changed URLs to Bing → ChatGPT's web index
⑦ measure  drive the real ChatGPT/Perplexity/Google-AIO apps, track Visibility/Position/Cited%
```

## What the audit checks (each = a verified June-2026 signal)

| Rule | Why it matters |
|---|---|
| `js-dependence` | **Critical.** AI crawlers don't run JS — client-only content is invisible. |
| `ai-crawler-block` | **Critical.** robots.txt blocking GPTBot/ClaudeBot/PerplexityBot = invisible in those answers. |
| `answer-block` | A 40–60 word direct answer up top is the Layer-2 citation lever. |
| `schema` / `schema-type` | JSON-LD presence/validity + site-level Organization/WebSite entity. |
| `question-headings` | Question-form H2s map to query-fan-out sub-queries (RRF retrieval). |
| `freshness` | Cited content skews fresher; stale/no-`dateModified` is penalized. |
| `promo-tone` | Promotional/commodity tone correlates **negatively** with AI citation; self-ranking "#1/best" backfires (~69%). |
| `title` / `meta-description` | Length budgets so SERP/snippet doesn't truncate. |
| `internal-links`, `img-alt`, `canonical`, `thin-content`, `sitemap`, `duplicate-titles` | Classic technical hygiene. |

## Safety model (read this)

- **Nothing auto-merges to production.** `apply` is gated behind `--yes`; the nextjs
  adapter lands changes on a fresh branch + PR for human review.
- **No content slop.** The decide layer only *restructures/tightens real content* and
  adds schema — it never invents claims, stats, or superlatives. (Google's 2026 AI-spam
  detection — S-BERT/S-CTS, burstiness — demotes generated filler.)
- **Off-domain is the company's job.** seo-bot handles on-site/technical/AEO. Brand
  mentions, reviews, and digital PR (which beat backlinks ~3:1 for AEO) are human work.

## Files

```
seo-bot/
  bin/seo-bot.mjs        CLI
  config/<name>.json     one per owned site
  src/
    config.mjs  util.mjs
    crawl.mjs              sitemap discovery + raw-HTML fetch + robots/AI-bot analysis
    rules.mjs  audit.mjs   the rule engine + scoring
    decide.mjs             findings -> fix proposals (LLM-assisted, slop-resistant)
    gsc.mjs                dependency-free Search Console client (JWT + REST)
    apply/                 dryrun | nextjs (PR) | wordpress (REST) adapters
    verify.mjs             server-render confirmation
    indexnow.mjs  measure.mjs  orchestrator.mjs
    research/              fetcher.mjs (acquisition) · credibility.mjs (scorer) · index.mjs (CLI glue)
  scraper/               fetch.py — Scrapling stealth sidecar (+ requirements.txt, README)
  config/source-trust.json  tiered source map + Google veto list
  reports/<client>/      generated audits, proposals, run summaries (gitignored)
```

## Research subsystem — "be smart, don't take info as true"

The bot keeps current by reading SEO/AEO sources (incl. X) — but treats everything
scraped as a **claim**, never a fact.

```bash
node seo-bot/bin/seo-bot.mjs research tweet <id>          # scrape an X post + score its credibility
node seo-bot/bin/seo-bot.mjs research fetch <url|id>      # acquisition only (tweet/RSS/HTML; stealth-escalates)
node seo-bot/bin/seo-bot.mjs research score "<claim>" --source x:@glenngabe [--traced] [--corroborators a,b]
```

- **Acquisition** (`src/research/fetcher.mjs`): X via the syndication endpoint, RSS, and
  plain HTML run natively in Node (no Python). Cloudflare/JS walls escalate to the
  **Scrapling** stealth sidecar (`scraper/`). Stealth ≠ auth bypass.
- **Credibility** (`src/research/credibility.mjs` + `config/source-trust.json`): every claim is
  `score = 0.6·sourceTier + 0.4·evidence − redFlags + corroboration`. SIFT caps an untraced
  "study" claim at 0.39; Google's May-2026 veto list (llms.txt, AI-only schema, inauthentic
  mentions…) is forced to review-to-reject. **Hard invariant: nothing here ever writes to
  `rules.mjs`** — a human reads the daily brief and hand-edits rules. A lone confident tweet
  scores ~0.3 → discard. See `../research/seo-daily/README.md`.

## Daily research

The bot's rules encode what's working *today*. SEO/AEO shifts fast, so a scheduled
daily deep-research routine refreshes `../research/seo-daily/` and flags when a rule
should change. See `../research/seo-daily/README.md`.
