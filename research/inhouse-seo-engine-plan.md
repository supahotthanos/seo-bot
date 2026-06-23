# In-House AI-SEO Engine — Build vs. Hire (June 2026)

> Decision doc for doing SEO/AEO **in-house** across onboarded med-spa client sites, with maximum automation and near-zero recurring tool cost. Pairs with `aeo-deep-research-2026.md` (the *strategy*) and `medspa-ein-aeo-playbook.md` (the *content system*). This doc is the *tooling + execution* layer.
>
> Internal-asset sections are final. The external OSS-shortlist / pricing / OTTO-teardown / local-automation sections are filled from the `inhouse-ai-seo-recon` workflow.

---

## 0. The headline

**Build (hybrid), don't buy-first and don't hire-first.** You are already ~60–70% of the way to an OTTO/Profound-class "AI SEO agent" — you just built it scoped to one site (`nobsmedspareviews.com`) instead of as a multi-tenant service. The work is **generalizing what exists into a per-client executor**, not starting from zero. A first SEO hire makes sense *later* as the operator who runs the agent and does the one thing it can't automate (off-domain relationship/PR), not as the person who replaces it.

Why this is the right call for you specifically:
- The single most expensive thing the paid AEO tools sell — **measuring real AI-answer visibility by driving the consumer apps, not the API** — you already wrote (`scripts/ai-visibility/track.mjs`). Your own README says *"This is the same approach Peec / Profound / Otterly use."*
- The durable AEO moat is **off-domain brand mentions + reviews + genuine third-party inclusion** (mentions beat backlinks ~3:1; self-serving "we're #1" listicles backfire ~69% of the time — see `aeo-deep-research-2026.md`). That moat is *relationship work*, not something Ahrefs/Otto sells you. So buying a big paid suite mostly duplicates the cheap/automatable half and skips the expensive/human half.
- You **control the client sites** — the rarest and most valuable precondition for an executor agent. OTTO's whole product is a hack to get write-access to sites it doesn't control (a JS pixel that mutates the DOM). You don't need the hack; you can write the real HTML server-side, which is *strictly better* for AI crawlers (they don't run JS).

---

## 1. What you've already built (mapped to what the paid tools charge for)

This is the core of the argument. Each row is an existing file in this repo doing a job a paid tool sells as a headline feature.

| Paid-tool feature (who sells it) | Your in-house equivalent | File |
|---|---|---|
| **AI-answer visibility / share-of-voice tracking** across ChatGPT/Perplexity/AIO via *consumer surfaces, not API* (Profound, Peec, Otterly — $90–$1,000+/mo) | `track:ai` — Playwright drives the real apps, parses citation trays, scores Visibility / Position / Cited% / competitor SoV, appends a trend CSV | `scripts/ai-visibility/track.mjs` + `prompts.json` |
| **AI-crawler / "agent analytics"** — which LLM bots actually fetch your pages, IP-verified (Profound Agent Analytics, CDN connectors — enterprise tier) | `crawler-store.ts` — logs GPTBot/ClaudeBot/PerplexityBot/Googlebot visits, verifies by CIDR, aggregates a 30-day dashboard | `lib/crawler-store.ts` |
| **Instant indexing** to Bing→ChatGPT (most suites bolt this on) | `pingIndexNow()` — batched IndexNow submission, dedup, host-validation | `lib/indexnow.ts` |
| **Schema / structured-data automation + answer-ready content** (Surfer, Frase, RankMath AI, OTTO) | `aeo.ts` — VideoObject/LocalBusiness/sameAs entity binding, Wikipedia/Wikidata entity URLs, OpeningHours, Speakable, title-budgeting, price/answer-capsule sentence builders, real-authority citation table | `lib/aeo.ts` |
| **On-page/site signal extraction** ("crawl the site, tell me what's there") | `enrich-flags.ts` / `enrich-images.ts` — cheerio scrape of a business's own site → structured flags/photos, concurrent, resumable, error-tracked | `scripts/enrich-flags.ts` |
| **Rank/SERP + keyword data plumbing** (Ahrefs/Semrush) | Partial — Playwright scraper fleet + DuckDuckGo/Brave discovery + Nominatim geocoding (all free); **no keyword/rank DB yet** (the real gap → §3) | `scripts/playwright-*.ts`, `scripts/find-real-websites-brave.ts`, `scripts/geocode-nominatim.ts` |
| **Brand-mention / UGC sourcing** (YouTube #2 cited domain, Reddit) | `ingest-youtube.ts`, `ingest-reddit.ts` already pull these | `scripts/ingest-*.ts` |
| **LLM content/optimization calls** | Anthropic SDK wired (`lib/anthropic*.ts`), sentiment/service-strength/editorial-summary generators | `scripts/analyze-*.ts`, `scripts/generate-*.ts` |

**Storage/infra already in place:** Supabase (prod data + crawler visits), Upstash (rate-limit), Next.js 16 SSR (server-rendered HTML = the binary AI-crawler requirement), Vercel.

**Translation:** the parts of OTTO/Profound that are genuinely hard, you have. What's missing is (a) a **keyword/rank data source** that isn't Ahrefs, (b) the **per-client multi-tenant wrapper**, and (c) the **"apply the fix" executor loop** that closes from *audit* → *change on the client site* → *measure*.

---

## 2. The build-vs-hire decision, plainly

**Three options and the real cost of each:**

1. **Buy a suite (Ahrefs/Semrush + OTTO/Profound).** ~$400–$1,500+/mo *per seat/domain*, scaling with client count. Duplicates the half you already automated; you still have to do the off-domain mention work by hand; you rent the thing that should be your differentiator. *Worst fit for "in-house, low-cost."*
2. **Hire an SEO first.** $4–8k/mo for a competent generalist, or $3–10k/mo agency retainer. They'll bring Ahrefs (another cost) and do manual work that doesn't scale across many client sites. *Right person, wrong sequence* — without the agent they're a cost center per client.
3. **Build the executor agent on what you have, hire one operator to run it later.** Marginal cost ≈ your time + ≤$50/mo of cheap API/proxy. Scales across every client site because the agent does the repeatable 80% (audit, schema, answer-blocks, internal links, indexing, measurement) and the human does the 20% that's actually a moat (earning mentions/reviews/inclusions). *Best fit.*

**The tell:** your strategy research already proved the durable wins are *off-domain consensus*, which no tool automates well. So paying for tools that automate the *on-domain* half — which you've largely built — is paying twice. Spend the money (later) on a person for the off-domain half, and spend *now* on finishing the agent for the on-domain half.

---

## 3. The real gaps to close (where new work / maybe-spend goes)

The honest missing pieces, regardless of tooling:
- **G1 — Keyword + rank data without Ahrefs.** Solved mostly for free *because you own the sites*: **Google Search Console API** (free, 50k rows/day/site — ground-truth queries/impressions/position/CTR per page; more valuable than any rank tracker for sites you control) + **Bing Webmaster `GetKeywordStats`** (free historical volume, fills "terms you don't rank for yet"). Only if you need competitor volumes/ranks GSC can't see: **DataForSEO Labs** metered (~pennies/task, $50 min deposit, *no monthly floor*), surfaced through self-hosted **every-app/open-seo** (MIT). Skip `pytrends` (archived Apr 2025 → `trendspyg`) and any "keyword tool" that secretly proxies paid SerpApi; hit `suggestqueries.google.com` free for autocomplete.
- **G2 — Per-client multi-tenant wrapper.** Today `prompts.json` and `aeo.ts` are hardcoded to `nobsmedspareviews.com`. Need a `clients/<slug>/config.json` (brand, domain, competitors, prompt panel, CMS adapter) and a runner that loops the existing scripts per client.
- **G3 — The "apply" adapter per client stack (the actual project).** No OSS tool does this — every "OTTO clone" only *detects*. ~300–500 lines you build and own: Next.js client → agent opens a **PR**; WordPress client → agent calls the **WP REST API** (+ RankMath) to set meta/schema/alt/headings; static → build-time inject. Plus a **raw-HTML `curl` verifier** that re-fetches the deployed URL to confirm the fix is server-rendered (visible to non-JS AI crawlers) — the explicit check that beats OTTO's pixel.
- **G4 — Local pack / geo-grid rank tracking** (med spas live or die on the map pack). No free LocalFalcon/BrightLocal OSS exists (the "localrankr" repo the model first suggested is *hallucinated — does not exist*). Build it from primitives: **Google Business Profile API** (free — read/reply reviews, weekly LocalPosts, photos, performance; requires per-client approval, multi-month gate → apply day 0) + a **DIY geo-grid** = a Playwright coordinate sweep over `gosom/google-maps-scraper` (MIT, 4.4k) to prove map-pack movement. `georgekhananaev/google-reviews-scraper-pro` (MIT, 264★) for review monitoring.
- **G5 — Orchestration.** A scheduler (Vercel Cron / GitHub Actions) that runs the loop nightly/weekly per client and opens a report/PR. Audit MCPs (`librecrawl-mcp`, `geo-optimizer-skill`) plug into Claude Code as agent *tools*.

---

## 4. The executor-agent architecture (grounded in your files)

The loop, reusing what exists. "Executor" = it doesn't just report, it ships the change to the client site.

```
            ┌─────────────────────────────────────────────────────────────┐
            │  PER-CLIENT CONFIG  clients/<slug>/config.json                │
            │  brand · domain · competitors · prompt panel · CMS adapter    │
            └─────────────────────────────────────────────────────────────┘
                                        │
   ── SENSE ────────────────────────────┼───────────────────────────────────
   GSC/Bing API (free, owned data)      │   enrich-flags-style crawl of the
   + AI-visibility track:ai (citations) │   client's OWN site (cheerio/Playwright)
   + crawler-store (which bots hit it)  │   + keyword/rank source [G1]
                                        ▼
   ── DECIDE ───────────────────────────────────────────────────────────────
   LLM (Anthropic SDK, already wired) diffs "what we have" vs "what wins":
     • missing/weak schema  → aeo.ts generators
     • no answer-capsule on a money page → aeo.ts sentence builders
     • thin internal-link mesh → templated link planner
     • title/meta over budget → aeo.ts pageTitle()
     • source-gap: domains cited by AI that aren't us → off-domain work order (human)
                                        ▼
   ── APPLY (the executor hands) [G3] ──────────────────────────────────────
   Next.js client → open a PR with the schema/content/link edits
   WordPress client → REST API / plugin writes the change
   Static client → build-time injection
   (Server-rendered HTML — NOT a JS pixel — because AI crawlers don't run JS)
                                        ▼
   ── PROPAGATE ────────────────────────────────────────────────────────────
   pingIndexNow() the changed URLs (Bing→ChatGPT) + sitemap ping
                                        ▼
   ── MEASURE ──────────────────────────────────────────────────────────────
   re-run track:ai weekly → trend.csv per client; crawler-store confirms
   AI bots re-fetched; KPI = "is the client the NAMED answer", not just cited
                                        └──────────► loop
```

**What's reused vs new:** SENSE/PROPAGATE/MEASURE are ~built (track.mjs, crawler-store, indexnow, enrich-*). DECIDE is partly built (aeo.ts + Anthropic). APPLY [G3] and the keyword source [G1] and the multi-tenant wrapper [G2] are the genuine new build.

**Guardrails baked in (from your own risk research):** never ship a self-ranking "we're #1" page; KPI is *recommended*, not *cited*; no fabricated stats/scores (FTC exposure); reallocate effort to GBP + real reviews + earned mentions (the consensus drivers the agent can *tee up* but a human closes).

---

## 5. Phased rollout (0–30 / 30–60 / 60–90)

- **Days 0–30 — foundation, measure + audit only, ZERO write-back.** Verify every site in GSC + Bing WMT; wire GSC/Bing/web-vitals pulls into Supabase/Postgres. Drop SiteOne + linkinator + Unlighthouse on the Mac Mini; capture a per-client baseline audit + AEO scorecard (`aeo-audit`) + GSC opportunity list as a client-facing "before." Generalize `prompts.json` → per-client config and point `track.mjs` at each client. **Apply for GBP API access via each client's Cloud project now** (multi-month gate). Deliverable: audit + scorecard, no code-writing yet.
- **Days 30–60 — executor write-back on ONE pilot client.** Pick a Next.js client. Build the write-back layer (G3): GSC-opportunity → LLM fix proposal → **PR opener**, with schema-dts JSON-LD + `generateMetadata` + answer-blocks; gate merges with Lighthouse CI + structured-data-validator + linkinator; add the raw-HTML `curl` verifier. Replicate on one WordPress client via WP REST API + RankMath. Capture citation baseline (`track.mjs`/oneglanse + elmo). Deliverable: pilot shipping agent-drafted, human-approved, server-rendered fixes; before/after CWV + AEO score.
- **Days 60–90 — scale + local + monitoring.** Cron the nightly pull→audit→propose across the portfolio (human approves merges). GBP now approved → auto weekly LocalPosts + draft review replies + DIY geo-grid map-pack proof. Add a query-fan-out pass (metehan777 pattern) to feed the editorial backlog. Optional: DataForSEO Labs + self-hosted open-seo *only if* competitor data is needed (get OK first). **Hire/assign one SEO strategist** to own prioritization, content judgment, and brand-mention outreach (the agent's blind spot).

---

## 6. Do NOT build / do NOT buy

- Don't buy a full Ahrefs/Semrush seat per client — you've automated the on-domain half; rent data per-call instead if needed.
- Don't replicate OTTO's JS-pixel approach — you control the sites; write real server-rendered HTML.
- Don't build self-serving listicle/doorway pages (backfires; site-reputation-abuse risk).
- Don't chase llms.txt or FAQ-schema rich results (llms.txt is low-leverage in 2026 — generate it cheaply, don't engineer around it; FAQ rich results killed May 2026).
- Don't adopt abandoned/stale tooling the recon flagged: `next-sitemap` (dead Sep 2023), `next-seo` (Pages-Router era), `react-schemaorg` (stale Jul 2021 → use `schema-dts` directly), `pytrends` (archived), `gego` and `firecrawl/llmstxt-generator` (deprecated). Pin `lighthouse-ci` (canonical but slow cadence).
- Don't use dead stealth libs: `undetected-chromedriver`, `puppeteer-extra-stealth`, `rebrowser-patches` lost the 2026 anti-bot benchmark → use **Patchright** / **nodriver** / **curl_cffi** / **Camoufox** (verify Camoufox fork health first).
- Don't vendor GPL/AGPL code into anything you distribute: `nodriver`, `Firecrawl` (AGPL-3.0), `RustySEO`, `gego` (GPL-3.0) are fine to *run as separate executables internally*, never to ship inside a product.
- Don't scale stealth scraping of Google/Maps recklessly. Post-*hiQ/Van Buren* public-data scraping isn't the real risk — **copyright (verbatim reviews) + GDPR (names/phones/emails) is**, and Google enforces Maps scraping with IP bans. So: scrape competitor/Maps data for **monitoring only**, throttle, run from a residential IP, and do all *writes* (review replies, posts) through the official APIs.

---

## 7. External recon findings (verified June 2026)

From the `inhouse-ai-seo-recon` workflow: 22 agents, ~150 web fetches, every repo below fetched on its GitHub page to confirm it's real, active, and licensed as stated. ★ = stars.

### 7a. The verified OSS stack, by layer (compose these — none is "the whole thing")
**Measurement (free, first-party — build around this):** Google Search Console API (free) · Bing Webmaster `GetKeywordStats` (free) · **web-vitals** (Apache-2.0, GoogleChrome, ~8k★) field CWV.
**Crawl/audit (free OSS, run on the Mac Mini):** **SiteOne Crawler** (MIT, 772★, v2.3.0 Mar'26) = primary Screaming-Frog replacement, single binary, no JS = sees what GPTBot sees · **SEOnaut** (MIT, 729★, Go/Docker) or **librecrawl-mcp** (MIT, v2.1.1 Jun'26, 37 MCP tools — plugs straight into Claude as a tool) · **Unlighthouse** (MIT, 4.7k★) site-wide Lighthouse · **linkinator** (MIT, 1.5k★) broken links · **AINYC/aeo-audit** (MIT, ships a Claude Code skill, 16-factor AEO score — small/9★, fork+pin) · **RustySEO** (GPL-3.0, run standalone) server-log proof that GPTBot/ClaudeBot fetched your HTML.
**Generate (free, server-side, type-safe):** Next.js native `app/sitemap.ts` + `app/robots.ts` + `generateMetadata` (NOT next-sitemap/next-seo) · **google/schema-dts** (Apache-2.0, 1.2k★) JSON-LD · **adobe/structured-data-validator** (Apache-2.0, CI gate) · **Auriti-Labs/geo-optimizer-skill** (MIT, 482★, MCP — emits llms.txt + schema) · WordPress: **RankMath Free** (GPL) + **spatie/schema-org** (MIT, 1.5k★).
**AI-citation monitoring (≈ free):** **oneglanse** (MIT, 71★, Camoufox-based — scrapes the *real* logged-in ChatGPT/Perplexity/Gemini/Claude/AIO UIs for the citation tray; APIs structurally can't return it) · **elmo** (MIT, 138★, Docker — healthiest OSS visibility dashboard). → *You already have this: `track.mjs`. oneglanse is the reference to borrow selector patterns from when ours drift.*
**Scraping intelligence layer:** **curl_cffi** (MIT, 5.9k★) default for server-rendered HTML · **nodriver** (AGPL, internal only) hard targets · **Crawlee-Python** (Apache-2.0, 9.2k★) orchestration · **Patchright** (Apache-2.0, 3.5k★, v1.61 Jun'26) undetected Playwright drop-in · **Botasaurus** (MIT, 4.8k★) · **Firecrawl** self-host (AGPL, 136k★).

### 7b. OTTO / SearchAtlas teardown (the thing you named)
OTTO's product is a **write-back loop** delivered by default as a **client-side JS "OTTO Pixel"** that mutates the DOM after load. **SearchAtlas's own docs admit the pixel route is invisible to crawlers that don't render JS — i.e. GPTBot/ClaudeBot/PerplexityBot.** So for AEO specifically, OTTO's default mode is partly self-defeating. Pricing ~$99–999/mo (white-label needs the $399 Pro tier), *per client*. **Verdict: replicate the loop, don't buy it** — you write the identical fixes (titles, meta, canonicals, alt, JSON-LD, internal links, answer-blocks, llms.txt) into **server-rendered source**, which is strictly better for both Google and AI engines and costs $0 in SaaS. (AlliAI $169–1,249/mo has the same pixel limitation.)

### 7c. What's genuinely worth paying for (and what isn't)
- **Ahrefs / Semrush:** the *only* thing hard to replicate by scraping is the **backlink/brand-mention index**. But your own strategy research says mentions beat backlinks ~3:1 for AEO, so it's low priority. If ever needed: **Ahrefs Starter $29/mo** ≫ Semrush ~$140/mo for this one job. Don't buy a full seat per client.
- **Rank tracking:** don't pay — GSC is free ground truth for sites you own. (OSS **SerpBear**, MIT 2k★, if you want a self-host rank-tracker UI.)
- **One optional metered line item:** DataForSEO Labs for competitor volumes/ranks — pennies/task, opt-in only (respects your no-paid-API rule).

### 7d. Cost reality
**$0–50/mo recurring SaaS.** All detect/generate/monitor tooling is free/OSS; GSC/Bing/GBP APIs free. Real costs: **LLM tokens** (content rewriting + agent orchestration — tens of $/mo across a small portfolio, your main variable), **residential proxy** for the citation panel (~$1–1.75/GB PAYG = a few $/mo), and the two things money *should* go to — **engineering time** to build the write-back loop and **one human SEO's salary**. A single OTTO seat alone costs more than this entire stack.

### 7e. The five risks that bite (from the critic pass)
1. **Several load-bearing OSS repos are tiny/single-maintainer** (aeo-audit 9★, structured-data-validator 13★, librecrawl-mcp 20★, oneglanse 71★) — real and recent, but **fork + pin commits**; never make a 9★ repo unforkably critical.
2. **The write-back layer is 100% yours to build and maintain** — it's the whole project, and it edits client *production* sites, so bugs are dangerous (mandatory human approval on every merge/REST write; never auto-merge).
3. **AI-UI scraping is a perpetual maintenance tax** — selectors break as chat UIs change; needs residential IP. (You already feel this with `track.mjs`.)
4. **GBP API approval is a real multi-month gate** per client — apply day 0; use the scraper as the interim review-monitor fallback.
5. **The human is not optional** — the agent can't do brand-mention/PR outreach (the actual moat) or reliably tell good answer-content from confident-but-wrong. "Build the agent **and** hire one SEO to run it" — neither alone.
