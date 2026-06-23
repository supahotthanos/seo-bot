# AI/SERP observation: stealth browsers, what really drives the engines, and does automation skew it (June 2026)

Deep-research synthesis for seo-bot's measurement layer (`scripts/ai-visibility/track.mjs`).
Bottom line up front, then the detail. (Most research streams rate-limited; this is the
verified core — treat tool versions as "check before install.")

## The one question everyone asks: does the browser automation skew what we capture?
**No — automation does NOT change the answer/ranking content.** ChatGPT and Google rank and
phrase answers from your *published HTML*; they neither know nor care that the capture came from
a stealth browser. A **logged-out, fresh-session, neutral-IP** request is the *intended* neutral
GEO baseline — the same posture Peec/Otterly use. Stripping account + search-history
personalization makes the capture MORE representative of a first-time/incognito searcher, not
less. **So do not "go cleaner" by switching to APIs or datacenter proxies** — the API is a
different product (no/forced-different web search; ~4% source overlap with the UI).

Two things DO change what you observe — both fixable, neither a reason to abandon automation:
- **(A) Geographic personalization — REAL.** AIO + AI Mode personalize by IP, so the Mac Mini
  pins every result to one city. Fix: force location with `&uule=<encoded city>` (+ consistent
  `gl`/`hl`); for multi-market brands, loop the prompt set over 2–5 city pins and store the city
  per row. *This is the only way automation changes WHAT you see.*
- **(B) Detection → suppression — REAL and DANGEROUS.** When a session is flagged (consent wall,
  reCAPTCHA "unusual traffic", Cloudflare/Turnstile, stripped/empty SERP) there is simply no
  answer block to parse. Recording that as "not mentioned" is a **false negative** that silently
  understates visibility. It's a failure of OUR scraper, not a ranking signal about the client.
  Fix: a block detector that marks the row `blocked` and **excludes it from the denominator**
  (vs `absent` = engine genuinely showed no answer = a real zero, which we keep).

What does NOT matter: logged-in vs out (out is the correct baseline); whether the scraper "looks
human" *to the answer model* (it reads static HTML either way); UI vs API for the skew question.
The decisive levers are **residential IP, explicit geo (uule), and a block detector** — not
fingerprint perfection for its own sake. Fingerprint quality matters ONLY to prevent (B).

## Stealth browsers better than vanilla Playwright (OSS-first, no paid tool)
Vanilla Playwright is the wrong default: it leaks `navigator.webdriver=true`, SwiftShader WebGL,
and a JA3/JA4 TLS fingerprint that matches no real Chrome — exactly what Turnstile/Google flag.
Keep the API surface, swap the engine:

1. **Camoufox via Scrapling's StealthyFetcher** — *already in the repo* (`seo-bot/scraper/fetch.py`,
   `--mode stealth`). A Firefox fork that patches fingerprints at the C++ level (webdriver,
   WebGL/canvas, JA3/JA4) — things JS-stealth can't reach. Best for the **Google engines**
   (`google_aio`, `google_aimode`, `google_organic`): they only need one JS render + no in-page
   typing, so fetch the rendered SERP HTML through the existing sidecar and parse it.
2. **Patchright** (Node, drop-in for `playwright`) — for the **interactive** consumer apps
   (`chatgpt`, `chatgpt_free`, `perplexity`) that need typing into a composer + waiting on a
   stream. Near-zero-diff: `import { chromium } from 'patchright'` keeps every selector/UA/option.
   Patches the Runtime.enable/CDP + webdriver leaks that get logged-out ChatGPT killed by Turnstile.
3. **Camoufox (Node bindings)** — heaviest, hardest to flag; fallback for anything Patchright
   still gets challenged on.

**Net:** Google engines → existing Scrapling/Camoufox sidecar · ChatGPT/Perplexity → Patchright.
No paid service, no datacenter proxy, no API. (Hosted stealth browsers — Browserbase, Steel,
Hyperbrowser, Bright Data Scraping Browser — are a *paid* last resort; OSS covers our case.)

## What PUBLICLY drives ChatGPT search citations (the `chatgpt_free` surface)
1. **Bing index presence + position** — ChatGPT search is built on Bing; not in Bing's top
   results → can't be surfaced. (Gating prerequisite.)
2. **Brand mentions / authority across the open web** — citation likelihood tracks third-party
   mentions (review sites, listicles, press), not just owned content.
3. **Quotable specificity** — numbers, named facts, attributable claims get pulled more than
   generic prose.
4. **Freshness** — recent pages + recent mentions for recency queries.
5. **Crawlability for OAI-SearchBot / GPTBot** — these crawlers do NOT execute JS, so CSR content
   is invisible (SSR fixes it); ~27% of sites accidentally block citation bots at the CDN/robots
   layer. (Inbound axis — `parity.mjs`, `connect/aibot-ips.mjs`, `crawl-to-cite.mjs` already check.)
6. **Query fan-out** — one prompt → many sub-queries; you can be cited via a sub-query you didn't
   target (`fanout.mjs`). **CITED ≠ RECOMMENDED** — being a source ≠ being named in the prose; track both.

## What PUBLICLY drives Google ranking + AI Overview / AI Mode source selection
1. **Organic top-10 position** — AIO + AI Mode draw sources predominantly from page-one results
   (for the query + its fan-out). Classic SEO position is the strongest lever in. (`serp.mjs`.)
2. **Query fan-out / passage relevance** — AI Mode decomposes the query, retrieves passage-level
   matches; one strong passage can earn a citation (`passage.mjs`, `fanout.mjs`).
3. **Freshness · 4. Brand mentions / entity authority · 5. Schema / answer-island structure**
   (`schema.mjs`, `sculpt.mjs`).
6. **Geo/IP personalization** — same query, different sources by city; neutralize with `&uule`.
7. **Crawlability + SSR for Google-Extended / non-JS AI crawlers** — same binary requirement.
   *AIO not firing at all is a legitimate true-negative (note it), distinct from a blocked session.*

## Non-interference protocol (make an automated capture == a real first-time user)
1. **Residential IP** (Mac Mini) — never datacenter (CAPTCHA'd at the routing layer). Single most
   important control; the bot already gets this right.
2. **Logged-out, fresh per-engine context** — the neutral baseline (keep the separate logged-in
   `chatgpt` adapter only as a deliberate, labeled second view; never mix the two denominators).
3. **Geo-pin every market** — `&uule` + 2–5 city pins for multi-market brands; store the city per row.
4. **Consent cleared once + persisted** (`storageState`) so every run renders results, not a wall.
5. **N-sample** — AI answers are non-deterministic; run each prompt ≥3× per engine and aggregate
   (visibility = % of runs mentioned), don't trust a single shot.
6. **Block-aware denominator** — `blocked` excluded, `absent` counted. Never let detection read as 0.
7. **Read-only + human-like pacing** — observe only; keep modest volume + DELAY jitter; HEADFUL for
   the interactive apps.

## What we changed in the bot (this session)
- `track.mjs`: Patchright-if-installed (graceful fallback to playwright); `detectBlocked()` +
  per-row `status` (answered/absent/blocked); **denominator excludes blocked**; `&uule` geo-pin on
  the 3 Google engines; blocked count in the summary + trend CSV. `patchright` added as an
  optionalDependency.

---

# v2 update (full 12/12-stream re-run) — corrections + the harder facts

The first pass was 1/12 (rate-limited). The re-run is complete and **corrects v1 in places** —
keep these over the section above where they conflict.

## The big flip: Patchright is the WRONG engine for Google
In the May-2026 Paterson benchmark (651 verdicts, residential IP), **Patchright HARD-BLOCKS on
google-search while Camoufox passes** — Firefox's TLS shape differs from the Chromium variants
Google gates. So the correct split is **per-surface**, not one driver:
- **ChatGPT + Perplexity → Patchright + `channel:'chrome'`** (real Chrome 148 TLS; isolated
  ExecutionContexts kill the `Runtime.enable` leak — the single most reliable 2026 tell).
- **Google (aio / aimode / organic) → Camoufox** (anti-detect Firefox, ~0% headless detection;
  already in-repo via Scrapling). *This is still TODO in code — see roadmap.*
- **Reserve: `nodriver`** (raw-CDP, the only zero-block tool in the benchmark, 28/28) — but AGPL +
  async-only refactor, so hold it unless a surface starts hard-blocking. Residential IP makes it
  likely unnecessary.
- **Don't**: stack rebrowser-patches on Patchright (redundant); rely on playwright-stealth alone
  (can't touch TLS/CDP); use curl_cffi/JA3 HTTP clients (a real driven browser already emits genuine TLS).

## Skew verdict — refined (and two v1 over-claims retracted)
Still: the model does **not** swap weights for a bot. The failure mode is **binary** — you get the
real answer or you get blocked/degraded; there's no evidence Google serves bots *different AIO
content*. But the re-run sharpened the priority of skews and **retracts two v1 claims**:
- **#1 lever is IP geo/location** (not just "a" factor). AIO/AI-Mode personalize by location, and
  **ChatGPT has NO uule** — it rewrites the prompt from your egress-IP city (OpenAI's own example:
  "restaurants near me" → "top restaurants San Francisco"). So for a client in another metro you
  must route ChatGPT through a residential exit in that metro **or** label the captured market +
  record the exit-IP city per row.
- **RETRACT:** "a bot can cite the same candidate sources as a human." Not true — retrieval/grounding
  is geo/session-conditioned, so a differently-located bot genuinely sees a different candidate set.
- **RETRACT:** "run-to-run change is mostly engine drift, not the harness." Both are large; a sloppy
  harness (rotating IPs, varying inferred geo, reused cookies) injects variance that *looks* like
  drift. Hold the harness fixed to isolate the real ~10–34% engine drift.

## Public factors — honesty labels + the real numbers
**ChatGPT** — what's actually on-record (sparse): you must let **OAI-SearchBot** crawl (disallowed
sites "won't appear"); ranking uses "a number of factors", "no way to guarantee placement"; IP
location rewrites the query. Everything else is third-party inference: **"ChatGPT = Bing" is now a
hypothesis, not a fact** (2025–26 testing suggests diversification + an own experimental index for
the free tier). Profound's 730k-conversation study: only ~18% of chats trigger search; ~6 sources
each; top-10 domains = only ~12% of citations (Wikipedia 5%, Reddit 3%) — **the "30 domains = 67%"
claim is a myth.** "Fast Answers" (Apr 2026, incl. logged-out) bypass memory on high-confidence
factual prompts → good for our logged-out baseline, but log which path fired. **Drop the hype:** the
"DA 40% / content 35%", schema-multiplier, and "71% of cited pages have schema" numbers are
unverified vendor estimates (a Dec-2024 study found no schema correlation). Defensible: ~15% of
answers cite, ~4% API-vs-UI source overlap.

**Google** — the May-2024 Content Warehouse leak confirmed NavBoost click signals + a real
`siteAuthority` field (the *schema*, not proof of live weight). Google's own line: AI features are
"rooted in core Search ranking"; it explicitly **debunks llms.txt / chunking / special AI
formatting**. Critical for us: **AIO-citation ↔ organic-top-10 overlap COLLAPSED from ~76% (Jul
2025) to ~17–38% (Feb 2026)** — ~31% of citations now come from positions 11–100. **Track AIO/AI-Mode
as their own metric; never infer from organic rank.** Detection = SearchGuard (Jan 2025):
`navigator.webdriver`, `$cdc_`/driver markers, >200 events/s, 100+ fingerprint checks.

## N-sampling is not optional — the variance is huge
arXiv 2601.21339: **10–34% within-model variance** on identical prompts; after 3 ChatGPT runs only
**~2% of citations persist**; weekly source churn ~5% (AIO) / ~56% (AI Mode) / ~74% (ChatGPT). So a
single shot is noise. Protocol: **N = 3–10 per (prompt, engine, wave), start N=5**; report
**median/mode + per-domain "appeared in k of N"** (not mean — hallucinated outliers drag it); flag a
domain "won" only if it persists across most runs AND waves; **re-try blocked samples** so they
don't shrink N. Expect AIO stable, AI-Mode/ChatGPT volatile — one missing ChatGPT citation is normal.

## Code gotchas the re-run found → what I fixed vs what's left
**Fixed this session:** silent vanilla-Playwright fallback (now logs the driver + warns loudly);
hard-coded Windows Chrome/124 UA on a Mac (dropped — platform-mismatch tell); missing `pws=0`
(added to all 3 Google URLs); single context reused across all prompts → self-contamination (now a
**fresh context per prompt**); `channel:'chrome'` for genuine TLS (with graceful fallback); kept
`detectBlocked` + denominator-exclusion (the most important guard); deprecation note on the authed
`chatgpt` path (prefer `chatgpt_free` for measurement).
**Roadmap (bigger, deliberately deferred):** (1) **Camoufox driver for the 3 Google engines** via
the Scrapling sidecar — the Patchright-blocks-Google fix; (2) **N-sampling** (N=5) with median/mode
+ k-of-N aggregation + blocked-retry; (3) record **served model / Fast-vs-Search path / exit-IP
city** per row; (4) a **self-check subcommand** (load CreepJS/rebrowser-bot-detector, assert
`webdriver=false`, real GPU, no HeadlessChrome UA) to gate captures; (5) `nodriver` in reserve.

## New since v1 (for reference)
Bing Webmaster Tools shipped an **"AI Performance" report** (Feb 2026) and Google GSC added
**Search-Generative-AI** performance reports (Jun 2026) — both free first-party cross-checks for AI
citations + new prompt-discovery sources (they don't expose the literal prompt). ChatGPT free tier
now personalizes from past chats + "dreaming" memory + connected Gmail (Jun 2026) → logged-out fresh
context matters more than ever.
