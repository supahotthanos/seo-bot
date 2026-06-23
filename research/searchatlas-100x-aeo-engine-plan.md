# The 100x In-House SEO/AEO Engine — Search Atlas Teardown + Build Plan (June 2026)

> **What this is.** A full, code-ready plan for an autonomous in-house SEO/AEO engine that does everything Search Atlas / OTTO does, but better, because we own the source, the DNS, the edge, the servers, and the dev team. It is built from a 47-agent / ~2M-token recon (raw findings in [`searchatlas-recon/`](searchatlas-recon/), full 328-unit backlog in [`searchatlas-100x-backlog.md`](searchatlas-100x-backlog.md)).
>
> **Audience.** You (running SEO), the in-house web-dev team, and the AI coding agents that will write the modules. Each work-unit names the `seo-bot/` file it touches, a complexity (S/M/L/XL), and acceptance criteria.
>
> **Relationship to prior docs.** Extends [`inhouse-seo-engine-plan.md`](inhouse-seo-engine-plan.md) (the build-vs-buy decision), [`seo-bot/README.md`](../seo-bot/README.md) (what exists), and [`seo-bot-integration-backlog.md`](seo-bot-integration-backlog.md) (the connector backlog). Where they conflict, this doc wins.

---

## 0. The headline (read this first)

**OTTO is a single-site SaaS overlay. We are a multi-layer infrastructure owner. That is the whole 100x.**

Search Atlas's entire product is a clever hack to get *write access to websites it does not own*. Its default delivery — the "OTTO Pixel" — is a `<script>` in the `<head>` that mutates the DOM **client-side, after load**. Search Atlas's own help center admits the consequence: *"AI crawlers and non-JS bots only see edge-rendered content, not JS-injected fixes."* So OTTO's flagship "LLM Visibility / AEO" product is, on its default setting, **invisible to the exact crawlers (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot) that AEO depends on.** Its fallback — bolting a Cloudflare Worker onto a DNS zone it doesn't own — is a third-party reverse proxy in the request path that, per independent testing (SPLX, Oct 2025), can drift into serving bots different content than humans (textbook cloaking).

We don't need the hack. We own the stack. Every fix OTTO injects as a fragile, rented, JS-only DOM mutation, **we write into server-rendered source** (visible to every crawler on first byte, permanent, free, version-controlled) — and we add a class of levers OTTO is *structurally locked out of*: real DNS records, our own edge middleware, our own server logs, a cross-domain entity graph, and statistically-gated autonomous experiments.

**You are ~60–70% there already.** `seo-bot/` audits raw HTML, proposes fixes, applies them via Next.js PRs / WordPress REST, verifies server-render, pings IndexNow, tracks AI visibility by driving the real chat apps, and gates decisions on a two-proportion z-test / FDR / diff-in-diff controller. The remaining work is: **(1) the edge + DNS layers OTTO can't have, (2) closing audit/content/entity parity, (3) the autonomous self-driving experiment loop, and (4) the multi-tenant + reporting wrapper.** All of it is in §4 as discrete work-units.

The one thing none of this automates is the durable AEO moat — **off-domain consensus** (brand mentions, reviews, genuine third-party inclusion; mentions reportedly beat backlinks ~3:1 for AI citation). The engine *tees that up* (§4 Epic 15); a human closes it. Build the engine **and** keep a human on the off-domain work — neither alone.

---

## Table of contents

1. [Search Atlas / OTTO — complete teardown](#1-search-atlas--otto--complete-teardown)
2. [The 100x thesis & target architecture](#2-the-100x-thesis--target-architecture)
3. [Capability gap matrix (OTTO vs us)](#3-capability-gap-matrix-otto-vs-us)
4. [The build plan — epics & work-units](#4-the-build-plan--epics--work-units)
5. [Phasing & sequencing](#5-phasing--sequencing)
6. [Operating model — how SEO runs automatically](#6-operating-model--how-seo-runs-automatically)
7. [Future radar — what we're missing on a forward basis](#7-future-radar--what-were-missing-on-a-forward-basis)
8. [Risks, guardrails & where the 100x reasoning is weak](#8-risks-guardrails--where-the-100x-reasoning-is-weak)

---

## 1. Search Atlas / OTTO — complete teardown

### 1.1 What it is

Search Atlas (LinkGraph; Manick Bhan) is a graph-backed SEO platform. **OTTO** is its execution/autopilot layer. Seven tiers:

| Layer | Modules | What it really is |
|---|---|---|
| **Data/Intelligence** | Site Explorer (Domain Power, Topical Dominance, LLM Visibility), Keyword Research, Site Audit (no-JS crawler, ~100-page default quota, up to ~1M/audit), Topical Map Generator | Resold third-party data (DataForSEO-class) + the client's own GSC. Keyword DB ~5.2B vs Ahrefs ~22B; backlink counts 18–23% lower than Ahrefs. **Not** a first-party index at claimed scale. |
| **Content** | Content Genius (live SERP-scraped topical graph), Scholar (NLP/entity-density scorer) | TF-IDF + NER + co-occurrence over the top-~20 competitor pages. Standard IR. |
| **Execution** | **OTTO** (detect → reason → generate → deploy → monitor) | The write-back engine — the product's center of gravity **and its central weakness**. |
| **Local** | GBP "Galactic", Local Heatmaps (geo-grid), Local Citations (~5 aggregators) | Real GBP API write-back; metered geo-grid; time-boxed citation push. |
| **Off-page** | WILDFIRE (2:1 reciprocal link exchange), Digital PR / Signal Genesys, HARO automation | Closed-network footer link trading + syndicated PR. High footprint/penalty risk. |
| **Growth** | Dynamic Indexing (IndexNow / Google Instant Indexing), crawl monitoring | Ping-based; can't control crawl at source. |
| **Reporting** | OTTO Grade, Report Builder (white-label), Portfolio Summary (0–100) | Read-only consolidation; loosely coupled to the task engine. |

**Pricing/credits (the rent extraction):** Starter $99 / Growth $199 / Pro $399 (first white-label tier) / Agency $999 per month. Three monthly-reset, **no-rollover** credit pools (AI Quota Points, AI Article Credits, Hyperdrive Credits). Overages ~$0.99/AI-point, $99/100 Hyperdrive credits. A single product-page optimization burns 10+ credits; one agency reported 27,000 OTTO recommendations where "500 credits covered ~2%." A real 10-client stack ≈ $797+/mo. **API is Enterprise-only** (custom quote); standard tiers expose a hosted v2 **MCP server** (`mcp.searchatlas.com`, ~587 tools, JWT auth) but no committed REST quotas.

### 1.2 The OTTO loop (how the bot actually works)

Five stages: **Detect → Reason/Prioritize → Generate → Deploy → Monitor/Rollback.**

- **Detect** — Site Auditor crawls (no-JS), pulls GSC + GA4 + GBP, flags issues against a fixed **"200+ technical issue" checklist** ("Holistic SEO blueprint"). OTTO fine-tunes on four first-party inputs: a content crawl (~10k pages), a user-configured **Knowledge Graph** (entities/tone/USPs), GSC, GBP.
- **Reason** — after GSC connects, "prioritizes based on live ranking signals," labels fixes "by impact and effort." **Verified weakness:** multiple reviewers report a flat, overwhelming task list ("dozens to hundreds") — *no real expected-value ordering.*
- **Generate** — the genuinely AI part: a user-selectable LLM (**ChatGPT / Claude / Groq**) writes the new values (titles, metas, alt, schema, GBP posts, articles), conditioned on the Knowledge Graph. **Detection itself is rules/thresholds, not ML** — the "AI agent" framing is marketing over a rule engine much like `rules.mjs`.
- **Deploy** — three-state lifecycle **Recommended → Deployed → Live**, gated by per-fix Deploy buttons + a master toggle (or "cruise control" autopilot). Delivered via pixel / Cloudflare / WP plugin (see §1.3).
- **Monitor/Rollback** — auto-revert on hard thresholds: rank drop >2 on the primary query, CTR drop >15% vs baseline, loss of an AI-Overview citation, or schema-validation failure. **Verified weakness:** threshold-based, not statistical — fires on small-sample noise, misses regressions on low-traffic pages, no control group, no diff-in-diff, no FDR.

### 1.3 Delivery modes — the architectural core (and core weakness)

This is the most important thing about OTTO. Same fix set, three architecturally distinct write-back paths; **the path determines whether AI crawlers ever see the change.**

| Mode | Mechanism | AI-crawler visibility | Persistence | OTTO owns it? |
|---|---|---|---|---|
| **A — OTTO Pixel** (default) | `<script>` in `<head>` (or GTM). Boots in-browser, fetches a per-URL fix manifest, **mutates the DOM at runtime** (title, meta, canonical, OG, JSON-LD, H1, alt, internal links). | **Visible only to JS-rendering bots (Googlebot).** **Invisible to GPTBot/ClaudeBot/PerplexityBot/OAI-SearchBot.** Rich Results Test often fails to detect pixel-injected schema. | **Ephemeral** — remove pixel / lapse sub → "enhancements stop rendering immediately." Needs "Deep Freeze" to persist. | No — payload on SA servers. |
| **B — Cloudflare DNS** | Client delegates nameservers to Cloudflare + grants SA a `Zone:DNS:Edit` token. SA runs a **Cloudflare Worker (HTMLRewriter)** that rewrites origin HTML at the edge before the bot sees it. | **"Seen by all crawlers, including non-JS AI bots."** The only AI-visible path. | "Stays active even after uninstalling the pixel." | **No — reverse-proxy bolt-on on a zone/token SA doesn't own.** |
| **C — WordPress (MetaSync)** | PHP writes real `<head>` tags + JSON-LD + virtual robots/sitemaps into the WP DB. | Server-rendered (all crawlers). | Persistent. | Partial (WordPress only). |
| **D — Manual CSV export** | Client hand-pastes into their CMS. | Server-rendered. | Permanent. | The only true source-of-truth mode. |

**Documented bugs (Search Atlas's own IDs):** `OTTO-1943` — "H1 changes invisible to non-JS bots, even though Googlebot sees the updated H1" (vendor-confirmed AI-crawler invisibility). React/Next hydration "intercepts and reverts OTTO's DOM changes" (deployments show "Engaged" but never render). `OTTO-1850` (inactive despite valid CF token), `OTTO-1931` (deployed changes revert), `SPE-666` (Worker corrupts `&`/apostrophes). Independent test: pixel adds **+29% load time, +44% FCP, +39% TTI.** Shopify App Store: **2.2/5**, 62% one-star. Content: a tester's 10 OTTO articles scored "100% AI-detection confidence," ~3–4 of 150 drove traffic.

### 1.4 Where OTTO is structurally locked out

These aren't bugs — they're consequences of being a SaaS overlay that doesn't own the stack:

1. **No server-rendered source of truth** (pixel path). The #1 AEO gap.
2. **No real DNS layer** — can't manage CAA/DNSSEC, SPF/DKIM/DMARC/BIMI, verification TXT, IndexNow key hosting, or cross-domain entity records.
3. **No server logs** — can't measure which AI crawler actually fetched which URL, so it can't close the crawl→citation loop.
4. **No statistical causal engine** — threshold rollback only; no held-out controls, no significance.
5. **No multi-domain entity graph** — it operates inside one site's runtime DOM.
6. **Rent + lock-in** — changes vanish on cancellation; credits expire monthly; data is resold and shared across all customers.

Every one of these is a lever we own. The rest of this doc turns them into code.

---

## 2. The 100x thesis & target architecture

### 2.1 The thesis in one line

> Replicate OTTO's *loop* (sense → decide → write-back → verify → measure), deliver every change **server-rendered + at our own edge** (never a JS pixel, never a third-party proxy), add the **DNS / log / multi-domain / autonomous-experiment** layers OTTO can't reach, and run it **multi-tenant at $0 marginal SaaS cost** with a human only on the off-domain moat.

### 2.2 Target architecture (extends today's `seo-bot/`)

```
                ┌──────────────────────────────────────────────────────────┐
                │ MULTI-TENANT CONFIG  seo-bot/config/<client>.json         │
                │ brand · domains[] · competitors · prompt panel · cms +    │
                │ edge + dns adapters · aiPolicy · risk tiers               │
                └──────────────────────────────────────────────────────────┘
   ── SENSE ───────────────────────────────────────────────────────────────────
   GSC + Bing WMT (free keyword/rank) · GA4 (AI-referral) · GBP · CrUX/PSI
   + RAW-HTML crawl/audit (no-JS, like an AI crawler)        [have: crawl/audit/rules]
   + SERVER/EDGE LOG INGEST  (which bots fetched what)        [NEW: Epic 5 — OTTO can't]
   + AI-visibility tracker (drives real ChatGPT/PPX/AIO)      [have: measure.mjs]
   + keyword-demand harvester (edge site-search + GSC join)   [NEW: Epic 14]
                                      │
   ── DECIDE ──────────────────────────────────────────────────────────────────
   priority = severity × GSC-impressions × CTR-uplift × 1/effort   [NEW scorer, A1]
   LLM (anti-slop, never invents) → fix proposals + content briefs  [have: decide+gates]
   entity graph · schema completeness · passage/citability · link sculpt
                                      │
   ── WRITE-BACK (the anti-pixel) ──────────────────────────────────────────────
   ① Next.js SOURCE PR (preferred) ──┐  server-rendered, permanent, git-versioned
   ② Edge middleware / Edge Config ──┤  instant, server-rendered, content-PARITY
   ③ Cloudflare Worker (non-owned)  ─┤  HTMLRewriter, then GRADUATE to source PR
   ④ WordPress REST / DNS records  ──┘  [have ①④ partial; NEW ②③ + DNS writer]
                                      │
   ── PROPAGATE ────────────────────────────────────────────────────────────────
   change-driven IndexNow federation + ISR revalidate + true per-URL lastmod  [Epic 5/12]
                                      │
   ── VERIFY ───────────────────────────────────────────────────────────────────
   raw-HTML render-parity assertion (no-JS == JS) + cloaking-safety gate  [have+NEW]
   + log confirmation the bot actually re-fetched it
                                      │
   ── MEASURE & EXPERIMENT ──────────────────────────────────────────────────────
   stats controller: 2-prop z + FDR + diff-in-diff + locked horizons    [have]
   → autonomous self-driving loop: bandit + counterfactual + guardrails  [NEW: Epic 12]
   → AI-SOV with CIs · crawl-to-cite funnel · citation-gap work order    [Epic 13]
                                      └────────────► loop (per client, scheduled)
```

**Reused (≈built):** crawl/audit/rules, decide+gates, apply (nextjs/wp/dryrun), verify, indexnow, GSC/Bing/GA4/GBP connectors, links PageRank, updates monitor, measure (AI-visibility), the stats controller. **Net-new (the 100x):** edge layer, DNS/trust layer, log intelligence, autonomous experiment loop, entity graph, content-IR scorer, multi-tenant + reporting wrapper.

### 2.3 The four delivery rules (non-negotiable)

1. **Source PR is the default.** Every fix that can live in the repo, lives in the repo (visible, permanent, reviewable).
2. **Edge is for speed/personalization, never cloaking.** Edge middleware may *guarantee* server-rendering for verified bots and inject schema, but the **visible textual facts must be byte-identical** to the human page — enforced by a CI parity gate (`gates.mjs` sibling). This is exactly where SPLX caught Search Atlas drifting; we make drift impossible.
3. **Cloudflare Worker is a hotfix lane, then it graduates.** Any edge-Worker change auto-emits a source PR; the override is removed once the PR merges and the verifier confirms server-render.
4. **Nothing auto-merges to production.** Apply is gated; high-traffic/YMYL pages always queue for human review (policy engine, §4 Epic 1).

---

## 3. Capability gap matrix (OTTO vs us)

Status: ✅ have · 🟡 partial · ⛔ missing. File = where it lives / will live.

| Capability | How OTTO / best-in-class does it | Our status | Action |
|---|---|---|---|
| Raw-HTML / no-JS audit | No-JS crawler, ~100-page default | ✅ `crawl.mjs`,`rules.mjs`,`audit.mjs` | Close the "200+ checklist" gaps (Epic 6) |
| **Server-rendered write-back** | Pixel (JS, AI-invisible) | 🟡 `apply/nextjs.mjs` (PR) | **Make it the spine; add metadata/schema/link/content fix types (Epic 2)** |
| **Edge write-back (no proxy)** | Cloudflare Worker (3rd-party) | ⛔ | **Vercel middleware + Edge Config + CF Worker adapter (Epic 3)** |
| **DNS / trust records** | — (can't) | 🟡 `onboard/dns.mjs` (read), `connect/cloudflare.mjs` | **DNS writer: CAA, SPF/DKIM/DMARC/BIMI/MTA-STS, verification, IndexNow key (Epic 4)** |
| **Server-log crawl intelligence** | — (no logs) | ⛔ (`aibot-ips.mjs` verifier exists) | **Log ingest → crawl-budget + crawl-to-cite loop (Epic 5)** |
| Priority ranking | "impact/effort," flat list | 🟡 sorts by GSC impressions | **EV scorer: severity×impressions×CTR-uplift×1/effort (Epic 1)** |
| Render verification | — (can't guarantee) | ✅ `verify.mjs` | **Add no-JS↔JS parity + per-bot assertion (Epic 2/6)** |
| Rollback | Threshold (>2 pos / >15% CTR) | ✅ stats controller | **Statistical auto-rollback + guardrails/SRM (Epic 12)** |
| Content optimization | Surfer/Content Genius TF-IDF+NER | 🟡 `content/*` + anti-slop gates | **SERP corpus + TF-IDF + content score + topic model (Epic 7)** |
| Schema | FAQ/Product (some dead in 2026) | 🟡 `schema.mjs` (lint) | **@graph generator + completeness + CI SHACL validator (Epic 6/9)** |
| Entity / knowledge graph | WordLift/InLinks (client JS) | 🟡 `sources/entity.mjs` | **@id graph, about/mentions, Wikidata writer, KG panel (Epic 9)** |
| Internal linking | "controlled anchors" | 🟡 `links.mjs` PageRank | **Weighted surfer PR + embeddings + sculpting (Epic 10)** |
| Local / GBP / geo-grid | Heatmaps + GBP Galactic | 🟡 `data/gbp.mjs`,`data/ga4.mjs` | **Self-hosted geo-grid + GBP write-back + NAP/citations (Epic 11)** |
| AI-visibility tracking | Profound/Peec-style | ✅ `measure.mjs` (real apps) | **SOV with CIs, sentiment, mention-vs-citation (Epic 13)** |
| AEO content structure | "answer-ready content" | 🟡 some rules | **Capsules <17w, fan-out, RRF, STTF harvester (Epic 8)** |
| Keyword/rank data | Resold (Enterprise API) | ✅ GSC + Bing (free) | **Fuse + edge demand harvester; optional metered DataForSEO (Epic 14)** |
| Backlink index | Resold | ⛔ | **Common Crawl web-graph + edge referer graph + optional DataForSEO (Epic 14)** |
| Link building / PR | WILDFIRE + Signal Genesys | ⛔ (by design) | **Owned newsroom + governed HARO tee-up — human-closed (Epic 15)** |
| Autonomous experiments | — (none) | ✅ stats controller core | **Bandit + counterfactual + self-driving loop (Epic 12) — our crown jewel** |
| Multi-tenant + white-label | DNS-pointed dashboard, $999/mo | ⛔ | **Client config + portfolio rollup + report renderer + MCP (Epic 1/16)** |
| **Permanence / cost** | Rented, credits expire | ✅ git, $0 marginal | Keep; market it (Epic 16 sales probe) |

---

## 4. The build plan — epics & work-units

16 epics. Each work-unit is `[complexity] (provenance) Title — what to build → acceptance`. Provenance keys map to [`searchatlas-100x-backlog.md`](searchatlas-100x-backlog.md) (full 328-unit raw list). **Hand an AI coder one epic at a time.** Per `AGENTS.md`, before touching Next.js APIs, read `node_modules/next/dist/docs/` — this is Next.js 16 and APIs differ from training data.

### Epic 1 — Multi-tenant foundation & prioritization *(the wrapper that turns one bot into a fleet)*

- **[M] (A1) EV priority scorer** — replace the GSC-impressions sort in `orchestrator.mjs` with `score = severityWeight(audit.mjs WEIGHT) × GSC_impressions × rankBand_CTR_uplift(gsc.mjs position) × 1/effort` (effort=1 if autoApplicable else 3). → *Accept:* `proposals-latest.md` leads with highest-EV fixes; beats OTTO's flat list.
- **[M] (A11) Task state machine** — add lifecycle `proposed→queued→approved→deploying→deployed→verified→(rolled_back|rejected)` to proposals in `decide.mjs`; persist `tasks.ndjson` per client (timestamp, actor human|auto, stable id). → *Accept:* every fix has a queryable status + history.
- **[L] (A11) Auto-deploy policy engine** — new `policy.mjs`: per task, auto-approve only (a) low-risk deterministic fixes (meta/title clamp) and (b) change-classes with proven non-negative outcomes in `stats` decisions; high-traffic/YMYL pages (GSC+GA4 risk tier) always queue. → *Accept:* runs in `orchestrator` step 4 before apply; med-spa legal rules never auto-approve.
- **[M] (A11) Batched review CLI** — `seo-bot review <client>` prints grouped queued tasks; `--approve-category`/`--approve-all-low-risk`/`--reject` write back to `tasks.ndjson` (OTTO's "Deploy all," but risk-tiered).
- **[M] (A11) Portfolio rollup** — `portfolio.mjs` scans all `config/*.json`, reads each `run-latest.json`, emits a 0–100 health table + cross-domain link/entity signals.
- **[S] (A6) Parity-matrix module** — `config/searchatlas-parity.json` mapping each OTTO module → the `seo-bot/` file that delivers it free; feeds the sales probe (Epic 16).

### Epic 2 — Server-rendered write-back parity *(the anti-pixel spine)*

- **[L] (A10/A6) OTTO-class fix renderer (Next.js Metadata API)** — extend `apply/nextjs.mjs` so each fix (title, description, canonical, robots, OG/Twitter, hreflang, JSON-LD, alt, internal links, FAQ blocks, answer capsules) is written as `generateMetadata`/server-component/source edits and opened as a PR. → *Accept:* `verify.mjs` confirms every fix present in **raw** HTML (no-JS).
- **[M] (A12/A2/B1) Render-parity verifier** — extend `verify.mjs`/`verifier.mjs` to fetch each URL twice (raw no-JS + headless JS) and twice more spoofing GPTBot/PerplexityBot UAs; **diff** title/meta/canonical/H1/JSON-LD; any SEO element existing only post-JS = "OTTO-class invisibility defect" → fail build. → *Accept:* a per-page parity score in the rubric; shipping a pixel-only fix is impossible.
- **[S] (A12) Persistence + perf guard** — assert every applied fix is in committed source (survives with zero subscription) AND gate deploys on CWV via `data/pagespeed.mjs`+`crux.mjs` so we never ship OTTO's +29% load regression.

### Epic 3 — The edge layer *(parity with OTTO's Cloudflare mode, on infra we own — no proxy, no cloaking)*

- **[M] (C1) Bot-class + geo edge classifier** — generate a Next.js 16 `proxy.ts` (Node runtime) that buckets UA into `x-bot-class` (ai-nojs|ai-search|social|googlebot|human) via the vendored AI-UA list (`connect/aibot-ips.mjs`) and forwards geo headers. → *Accept:* downstream `generateMetadata` can read the bucket; never varies on raw UA (cache-safe).
- **[L] (A11/A1) Edge-overlay apply adapter** — `apply/edge.mjs`: write approved fixes (meta, JSON-LD, canonical, capsules) to **Vercel Edge Config / Upstash** consumed by middleware → live in seconds, **server-rendered**, no full deploy. Register in `apply/index.mjs`. → *Accept:* fix visible in raw HTML within seconds; one-command rollback (flip Edge Config).
- **[L] (A12/B8/D3) Bot-aware pre-render middleware (content-parity)** — for **verified** AI-crawler IPs (CIDR via `aibot-ips.mjs`) guarantee fully server-rendered HTML + enriched JSON-LD, JS chrome stripped, consent walls suppressed. **Mandatory cloaking-safety CI gate:** bot vs human visible text must match within threshold. → *Accept:* parity test in CI; divergence downgrades the variant to advisory.
- **[L] (B9) Cloudflare Worker adapter + graduation** — `apply/cloudflare-worker.mjs` (HTMLRewriter) for clients NOT on our edge; **`graduate` step** auto-emits a source PR and removes the Worker once merged + verified. Includes a streaming-safe HTMLRewriter codegen lib (text-node chunking, idempotent injection, try/catch).

### Epic 4 — DNS & trust layer *(levers OTTO is structurally locked out of)*

- **[M] (C2) DNS trust auditor + scorer** — extend `onboard/dns.mjs`: detect DNSSEC (DS/DNSKEY via DoH), parse CAA, flag TTLs, emit a 0–100 "DNS trust" subscore + fixes (no DMARC, no CAA → any CA can issue, no DNSSEC, MX absent).
- **[L] (C3) Email-auth posture + writers** — score SPF/DKIM/DMARC/MX (0–100); extend `connect/cloudflare.mjs` with gated writers for staged DMARC (`none→quarantine→reject`), BIMI, MTA-STS, TLS-RPT, CAA; scaffold the HTTPS-hosted BIMI SVG / VMC + `/.well-known/mta-sts.txt` routes via `apply/nextjs.mjs`. → *Accept:* improves deliverability of off-domain outreach (Epic 15) + brand trust; **note: these are trust/deliverability/verification levers, not direct ranking factors** (see §8).
- **[L] (C3) Autonomous DMARC promotion** — ingest `rua` reports (`data/dmarc.mjs`), advance policy only when authenticated-pass rate clears a threshold over a locked horizon (reuse `stats/controller.mjs`).
- **[M] (C2/A12) Verification + IndexNow-key + entity TXT writer** — one-pass writer for GSC/Bing/Pinterest/Meta verification TXT, IndexNow `{key}.txt`, and cross-domain `sameAs`/entity records. Auto-handshake on onboard so the free GSC/Bing connectors light up with no manual step.
- **[S] (C2) Subdomain-fragmentation guard + multi-domain IndexNow key federation** — flag SEO-fragmenting subdomains, recommend edge-rewrite consolidation; one rotating IndexNow key across all owned domains.

### Epic 5 — Crawl intelligence from our own logs *(OTTO has no server)*

- **[L] (C5) Log-drain ingest + store** — `app/api/seo-logs/route.ts` receiving Vercel Drains (JSON+NDJSON) + `connect/cloudflare.mjs` Logpush; signature-validate; filter to bot rows + ≥400s; normalize `{ts,ip,ua,path,status,bytes,ms,referer}` to Supabase. → *Accept:* a queryable rolling log store.
- **[M] (C11/B6) Verified-bot tagging (hardened)** — fix `aibot-ips.mjs`: real IPv6 CIDR (BigInt mask), add Googlebot/Bingbot (forward-confirmed rDNS), CCBot/Amazonbot/Bytespider; `tagBots(events)` stamps verified/spoofed/human.
- **[L] (B6/C5) Crawl-budget analyzer** — per URL-template: crawl ratio (% strategic URLs Googlebot fetched), waste % by 3xx/4xx/5xx/params/facets/soft-404, orphan + never-crawled set-join (logs ∪ sitemap vs internal-link crawl), JS render-gap (Phase1→Phase2 WRS lag). → *Accept:* turns waste into gated proposals in `decide.mjs` (robots Disallow, 410/301, canonical, sitemap lastmod).
- **[M] (A12/D7) Crawl-to-cite funnel** — join verified GPTBot/OAI-SearchBot/PerplexityBot/ClaudeBot hits per URL to the AI-visibility citation set → "crawled-but-never-cited" (passage problem) vs "never-crawled" (indexation problem); feed `stats`. **This closes the loop OTTO cannot.**
- **[M] (C5/B6) Continuous monitor + zero-fetch alert** — daily cron; alert when a verified bot's fetch count drops to zero, crawl ratio falls, or waste rises.

### Epic 6 — Audit parity & expansion *(match the 200+ checklist, then exceed it)*

- **[M] (A1) Holistic-blueprint gap closer** — add to `rules.mjs`: redirect-chain, broken-internal-link (404), blocked-resource, indexation-conflict (canonical vs noindex vs sitemap mismatch).
- **[M] (C9) Schema completeness + rich-eligibility** — upgrade `schema.mjs` from type-counting to required/recommended-property checks per node (LocalBusiness/MedicalBusiness/Review/AggregateRating/Service/Offer/Breadcrumb), per-page 0–100 rich-eligibility. **Stop rewarding FAQ/HowTo (rich results dead May 2026).**
- **[L] (C9) Offline SHACL/ShEx CI validator** — port Schemarama shapes + Google's required-prop shapes; validate in CI (no Google call; `validator.schema.org` refuses programmatic use).
- **[M] (a11y backlog) axe-core a11y pass** — auto-PR safe rules (alt/contrast/labels); ADA/WCAG 2.1 AA is a live legal lever for healthcare (don't *claim* "ADA compliant").
- **[M] (A6) JS-render-aware full-site auditor** — full crawl via owned sitemaps+logs (beat OTTO's ~100-page cap) with explicit no-JS↔JS diff per URL.

### Epic 7 — Content intelligence *(Surfer / Frase / MarketMuse parity, grounded + anti-slop)*

- **[M] (B2) SERP corpus builder** — `content/corpus.mjs`: fetch top-N organic (reuse `crawl.mjs`; seed via GSC/Bing to honor "no paid API"), strip to body text, cache with TTL.
- **[M] (B2) TF/TF-IDF n-gram extractor** — `content/terms.mjs`: 1–3-gram TF-IDF over the competitor set → ranked "terms to use" with competitor mean/min/max ranges (Surfer-style).
- **[L] (B2) Content Score (0–100)** — `content/score.mjs`: term-coverage + structural conformance (word count, headings, images, schema) + per-location signal scoring (title/H1/Hn/body/alt/anchor).
- **[L] (B3) Topic model + coverage gates** — `content/topicmodel.mjs` (TF-IDF + importance) feeding a `gates.mjs` soft coverage gate (MarketMuse 2-mention cap to avoid stuffing) and a build-time merge gate (must clear coverage before PR merges).
- **[M] (B4/C6) Programmatic uniqueness gates** — `gates.mjs` hard gate: per-URL unique-first-party-data ratio (shingles vs template scaffold + SERP), require non-empty `uniqueData` (real local price, ≥1 verified listing, ≥1 real review). Compile-time **NOT-NULL unique-data invariant** in the Next.js generator (refuse to emit a thin route).
- **[M] (B4) Publish-cadence governor + scale-up significance gate** — cap drafts/7-day window with jitter; **cannot generate batch N+1 for a cluster until batch N shows significant good-click lift** (stats). Cluster-level cannibalization pruner (shingle/Jaccard across the site → merge/prune).
- **[M] (B2/B3) Scorer→fix closed loop** — term-gap fixes inserted into **real existing sentences only** (never invent; pass `gates.mjs`), applied server-side, validated causally by `stats`.

### Epic 8 — AEO / answer-engine optimization *(be the named source)*

- **[M] (D1/D2) Answer-capsule + question-heading rules** — `rules.mjs`: each H2/H3 is a real question; first 40–60 words form a self-contained answer (no dangling anaphora, contains the entity + a concrete claim); declarative answer sentences **≤17 words** (citability ceiling). GEO method scorer: reward inline statistics (+34%), quotations (+44%), cited sources (+29%); penalize keyword stuffing.
- **[L] (D1) Passage-independence linter** — `passage.mjs`: chunk (~400–600 tok, 15% overlap), score each chunk for self-containment, output rewrite suggestions.
- **[M] (D1/D2) Query fan-out simulator** — `fanout.mjs`: generate the ~8 patent-class sub-queries (+ med-spa variants: price/safety/downtime/near-me/comparison); check each is answered in a citable passage; gaps → content plan. (Answering main + ≥1 sub-query ≈ +161% citation odds.)
- **[L] (D1) RRF citation predictor** — `rrf.mjs`: `score=Σ1/(60+rank)`; embed our vs competitor passages per sub-query, fuse, report whether we win fusion **before** publishing.
- **[M] (D2) STTF citation-fragment harvester** — `aio-fragments.mjs`: from real AIO/AI-Mode SERPs (the AI-visibility driver), parse `#:~:text=` anchors to capture the **exact sentence** Google pulled per query (ours vs competitor) → rank-decoupling dashboard (rank vs citation).
- **[M] (D3/D8) Server-rendered capsule/table/transcript/video emitters** — answer capsules + pricing tables as semantic `<table>`; VideoObject+Clip JSON-LD + crawlable transcripts (`<details>` with chapter anchors); image ImageObject + AVIF. (YouTube is a top-cited AI domain.)
- **[M] (D4) Gemini grounding telemetry** — `connect/gemini-grounding.mjs`: call Gemini w/ the `google_search` tool over the prompt set, parse `groundingMetadata` for exact cited chunks (cheap API; per the no-paid-API rule, only with your OK).

### Epic 9 — Entity & knowledge graph

- **[L] (B7) Entity extraction + @id graph** — `entity/extract.mjs` (med-spa gazetteer + NER over crawled HTML) → `entity/graph.mjs` (Supabase, `@id` on client domain, `sameAs[]`, `synonyms[]`, page-entity roles about|mentions).
- **[M] (B7/C9) about/mentions schema + dereferenceable @id** — emit `about`/`mentions` JSON-LD merged into one `@graph` keyed by `@id`; serve each entity's doc at its `@id` URI (`/entity/[slug]/route.ts`) so URIs actually dereference (true Linked Data; a SaaS tenant can't add a route).
- **[M] (D5) Entity reconciliation auditor** — upgrade `sources/entity.mjs`: detect ambiguous/duplicate KG nodes; pull Wikidata statements; build the full recommended `sameAs` (Wikidata>Wikipedia>LinkedIn>Crunchbase>GBP) with consistency checks.
- **[L] (D5) Wikidata writer + Knowledge-Panel assist** — `connect/wikidata.mjs` (OAuth, gated, notability heuristic) to create/maintain the item; KG-panel claim handshake via GSC verification.
- **[L/XL] (C4/D5/C7) Cross-domain entity graph** — portfolio-level binder: identical `sameAs` across owned properties; `parentOrganization`/`branchOf` per location; cross-domain weighted PageRank for directory→profile→service equity flow.

### Epic 10 — Internal linking & PageRank

- **[M] (C7) Weighted reasonable-surfer PageRank** — refactor `links.mjs` `pagerank()` for per-edge weights from region (body/nav/footer), DOM position, anchor length, relevance.
- **[L] (C7) Embeddings + semantic candidates** — `embed.mjs` (local Ollama nomic/bge, cache by content-hash) → candidate links where cosine ≥0.78..0.6, with placement offset + relatedness.
- **[M] (C7) Entropy-constrained anchor selector + sculpting + orphan rescue** — anchor variants (anti-slop gated, entropy-bounded); greedy/ILP link-budget optimizer (push money pages above median PR, depth ≤3, 5–44 links/page); true orphan set (sitemap ∪ GSC ∪ logs − crawl-linked).
- **[M] (C7) Server-rendered link apply + diff-in-diff** — insert `<a>` into source at chosen offsets (PR), never client JS; register each batch as a stats experiment vs matched controls.

### Epic 11 — Local / GBP / geo-grid

- **[L] (A7/B10) Self-hosted geo-grid scanner** — coordinate generator (`latStep`/`lngStep` math) + per-pin Google Local Finder queries via the **stealth Mac-Mini path** (or metered DataForSEO ~$0.0006/pin); metrics SoLV/ARP/ATRP + per-pin deltas → `stats`; SVG heatmap report. **(Per memory: website-first + stealth Maps; no unrequested paid Places.)**
- **[L] (A7/B10) GBP write-back** — extend `data/gbp.mjs`: draft+publish LocalPosts (recurring), draft review replies (human-approve; **never sentiment-gate — FTC 16 CFR 465**), Q&A. Requires the multi-month GBP API approval — apply day 0.
- **[M] (A7/B10) NAP consistency + citation gap** — canonical NAP source-of-truth → on-site LocalBusiness schema + GBP + citation submissions; competitor citation-gap finder; auto-PR drift.
- **[M] (A7/B10) Red-cell → landing-page bridge** — map weak grid cells to neighborhoods → propose server-rendered city/service pages (through content gates).

### Epic 12 — Autonomous self-driving experimentation *(the crown jewel — OTTO has nothing like it)*

- **[L] (C10) Experiment registry + page bucketing** — `experiments/registry.mjs` + `bucketing.mjs`: same-template URLs split into matched control/variant buckets by baseline traffic.
- **[L] (C10) Thompson-sampling allocator** — `stats/bandit.mjs`: Beta-Bernoulli CTR posteriors per title/meta variant; allocate next slot by sampling; update from GSC CTR.
- **[XL] (C10) CausalImpact counterfactual** — `stats/counterfactual.mjs`: fit variant-on-control over baseline, forecast no-change trajectory, bootstrap the post-launch lift CI (builds on `significance.mjs`).
- **[M] (C10) Guardrails + SRM + auto-rollback** — `stats/guardrails.mjs`: non-inferiority tests on GA4 conversion, organic clicks, CWV, AI-citation rate; chi-square SRM on the split; auto-revert losers.
- **[L] (C10) Edge variant assignment + kill-switch** — Edge-Config-backed middleware assigns the variant **deterministically per page** (NOT per user/cookie/agent — Googlebot and humans get the same single rendering) with an instant kill-switch.
- **[L] (C10) Self-driving loop** — `experiments/loop.mjs` + an `orchestrator` step: auto-nominate experiments from open proposals on high-traffic templated clusters, launch via `apply/edge.mjs`, evaluate at locked horizons, promote winners to source PRs, revert losers. **This is the "set SEO on autopilot" piece — gated by statistics, not vibes.**

### Epic 13 — Measurement & AI visibility

- **[L] (D7/B8) SOV sampler with CIs** — extend `measure.mjs`: R repeats/engine (per-engine sample-size targets, e.g. Gemini ~40–50, Perplexity ~90–100, SearchGPT ≥150 for ±5pp), bootstrap CIs, suppress sub-noise-floor readings; metrics Visibility, Share-of-Voice, Avg Position, **mention-vs-citation split**, sentiment + verbatim snippet.
- **[M] (D7) Prompt-panel generator** — funnel×geo×fan-out panel (30–40% unbranded category, 30–40% comparison, branded) from config.
- **[M] (D7) GA4 AI-referral + dark-traffic** — harden the AI-source regex (chatgpt/perplexity/gemini/claude/copilot/deepseek/grok/meta/you…), per-engine sessions+conversions; **auto-refresh the regex from our own edge logs** (new engines show up in our logs first).
- **[L] (D7) Citation-gap → work order** — for every priority prompt where a competitor is cited and we're not, classify the cited domain (own vs Reddit/Wikipedia/G2/listicle/news) → emit either an on-site brief (Epic 7/8) or an off-domain task (Epic 15).
- **[M] (D7) Feed AI-SOV into the significance controller** — wrap before/after SOV + AI-referral conversions as change records for `stats/controller.mjs`.

### Epic 14 — Keyword & link data (free-first)

- **[M] (A5) Free keyword fusion** — fuse GSC + Bing WMT + (your own) Google Ads Keyword Planner ranges + Trends into one normalized record (replaces the Enterprise-API/DataForSEO resale).
- **[L] (A5) Edge query-demand harvester** — capture internal site-search terms, GSC-referred landing queries, facet selections, zero-result searches → a per-geo/per-service demand index (first-party demand OTTO can't see).
- **[L/M] (B5) Backlink truth without Ahrefs** — Common Crawl host web-graph (external PageRank on the Mac Mini) + edge-referer live-link graph + **optional** metered DataForSEO Backlinks (budget-guarded). Backlink-gap/prospecting analyzer.
- **[S] (B5) Unit-budget guard** — shared cost ceiling + provider cost-header parser for every metered connector (`util.mjs`/`cost.mjs`).

### Epic 15 — Off-domain tee-up *(the moat — engine tees up, human closes)*

- **[M] (D6) Citation-gap target discovery** — rank claimable cited domains where the client is absent → `{host,type,citations,engines,prompts,suggestedAction,contactPath}` worklist (`sources/index.mjs`).
- **[M] (D6) Source-request tee-up** — `offsite/queries.mjs`: ingest HARO/Featured/Qwoted feeds, filter to vertical, auto-draft human-ready expert quotes grounded **only** in client facts (anti-slop gated).
- **[L] (D6) Brand-mention monitor + attribution** — poll Google Alerts/Bing News/Reddit/YouTube + the AI-citation set; join new mentions to GSC branded-search + GA4 + AI-SOV (diff-in-diff).
- **[M] (D6/A9) Owned-newsroom PR + magnet assets** — entity-rich releases (NewsArticle + Organization sameAs, author=client) on an owned newsroom subdomain, canonical to client, IndexNow-federated; original micro-studies / comparison / methodology pages built to be cited. **Free/cheap syndication, dedup-guarded — replaces Hyperdrive credits.**
- **[S] (D6/D9) Compliance guardrail** — Reddit/Quora/YouTube = flag-track/manual only; FTC + Google review-gating hard blocks; fake reviews never auto.

### Epic 16 — Reporting, white-label, MCP & sales weapon

- **[L] (A11) White-label client report renderer** — `report-client.mjs`: audit score, GSC deltas (WoW), GA4 AI-referral, AI-SOV, tasks deployed/rolled-back, LLM exec summary; branded; served from our own Next.js app ($0 vs $999/mo Agency tier). Scheduled cron delivery.
- **[M] (A10) Internal MCP surface** — wrap audit/propose/apply/verify/rank/AI-visibility/links/updates as an MCP server so internal agents (and Claude Code) call them like `mcp.searchatlas.com` — free.
- **[M] (A12) Competitive OTTO-defect probe** — extend `inspect.mjs`: given a prospect URL, detect the OTTO pixel / CF-Worker signature and report exactly what it hides from AI crawlers (JS-only meta/H1/schema, subscription-dependent reverts, +44% FCP). A ready-made "what OTTO is hiding from ChatGPT on your site" sales report → `sales-playbook/`.

---

## 5. Phasing & sequencing

Most recon agents tagged work "now" out of eagerness; here is the realistic order. Each phase is independently shippable and each makes us *strictly* beat OTTO sooner.

**Phase 0 — Spine & the structural wins (weeks 1–3).** The minimum that makes us categorically better than OTTO:
- Epic 1: EV scorer + task state machine + policy engine.
- Epic 2: full server-rendered fix renderer + **render-parity verifier** (this alone defeats OTTO-1943).
- Epic 3: edge-overlay apply + bot-aware pre-render (content-parity gate).
- Epic 4: DNS writer + verification/IndexNow-key handshake.
- Epic 5: log ingest + verified-bot tagging + crawl-to-cite loop.
- *Deliverable:* a fix lands in **server-rendered** HTML, is confirmed visible to a spoofed GPTBot, propagates via IndexNow, and we can prove from logs the bot re-fetched it. OTTO cannot do this end-to-end.

**Phase 1 — Parity & depth (weeks 4–8).** Epic 6 (audit/schema/a11y), Epic 7 (content IR), Epic 8 (AEO capsules/fan-out/STTF), Epic 9 (entity graph), Epic 10 (link sculpting), Epic 13 (SOV with CIs + work order). Multi-tenant the whole thing across the portfolio.

**Phase 2 — Autonomy & local (weeks 8–14).** Epic 12 (the self-driving experiment loop — the crown jewel), Epic 11 (geo-grid + GBP write-back, once API approval lands), Epic 14 (keyword/link data), Epic 16 (reporting + MCP + sales probe).

**Phase 3 — Moat & frontier (ongoing).** Epic 15 (off-domain tee-up, human-closed), Wikidata/KG establishment, plus the §7 future bets.

> **Highest-leverage single thing to build first:** the **render-parity verifier (Epic 2)** + **server-rendered fix renderer**. It's the smallest unit that converts our core structural advantage into an automated, provable guarantee — and it doubles as the sales weapon (Epic 16 probe) that shows prospects their OTTO fixes are invisible to ChatGPT.

---

## 6. Operating model — how SEO runs automatically

Reuse the scheduled-task runner. Per `seo-bot/README.md` cadence, extended:

| When | Command / job | What |
|---|---|---|
| **Per new site** | `onboard <domain> --write-config` → DNS handshake → `citations` | DNS/stack/baseline + verification TXT + IndexNow key + NAP capture + tiered citation worklist |
| **Continuous (edge)** | log drain → ingest | crawl-budget + crawl-to-cite + zero-fetch alerts; AI-source regex auto-refresh |
| **Daily** | `seo-aeo-daily-research` + algo monitor | study operators, tier claims, propose rule deltas (human-gated); freeze stats during core updates |
| **Daily/Weekly** | `run <client>` (+ self-driving loop) | re-audit → EV-rank → auto-apply low-risk / queue YMYL → verify parity → IndexNow → measure SOV → launch/evaluate experiments |
| **Weekly** | stats decision at locked horizons | keep/revert/try-next per the z-test/FDR/DiD controller; auto-rollback losers |
| **Monthly** | `citations`, geo-grid, schema/a11y sweep | NAP/citation re-check, map-pack proof, rich-eligibility + ADA lever |
| **Post core-update** | `run` across portfolio | E-E-A-T battery when the daily routine confirms a rollout |

**Human-in-the-loop split:** auto-apply low-risk deterministic on-site fixes (gated by the policy engine + statistics); **always queue** high-traffic, YMYL, legal-sensitive med-spa, and any net-new content; **human-only** the off-domain moat (mentions/PR/reviews — the engine tees up, you close). Nothing auto-merges to production.

**The web-dev team's role:** own the Next.js app shells, review/merge the bot's PRs, build the edge middleware + Edge Config wiring once (Epic 3), and wire the log drain (Epic 5). After that the engine runs itself; the team handles exceptions and net-new templates.

---

## 7. Future radar — what we're missing on a forward basis

Posture: **Build now** / **Prototype** / **Monitor**.

1. **Cryptographic crawler identity — Web Bot Auth (RFC 9421 / draft-meunier-web-bot-auth).** *(Prototype, work-unit C11)* As OpenAI/Anthropic/Perplexity begin signing requests, upgrade bot verification from CIDR-guessing to Ed25519 signature verification against published JWKS. Stub it now in the edge router.
2. **Agentic commerce / agent-readability.** *(Prototype → Build)* AI agents will increasingly *transact* (book the appointment, not just cite the page). Expose structured booking/availability/price via schema + an MCP/tool surface (Epic 16) so an agent can act, not just read. This is the next "be the named source" — be the *bookable* source.
3. **New AI engines detected from our own logs first.** *(Build now — D7)* The auto-refreshing AI-source regex makes us the first to know when a new engine (or a new AI crawler UA) appears, because it shows up in our edge logs before any tool reports it.
4. **Standards/rich-result churn.** *(Monitor)* FAQ/HowTo rich results are dead (May 2026); image sitemaps simplified to `<image:image>`+`<image:loc>`; ccTLD/International-Targeting geo signals sunsetting; Bing `lastmod` is now a Copilot freshness signal. Keep `updates.mjs` watching; don't engineer around dead features.
5. **llms.txt is a near-zero-value hedge.** *(Build once, cap effort — C11)* ~97% of llms.txt files get zero crawler requests. Emit a spec-correct static file; do **not** build optimization machinery around it.
6. **Entity establishment as the durable AEO substrate.** *(Build — Epic 9)* Wikidata/Wikipedia/Google-KG presence + cross-domain `sameAs` is what makes an LLM resolve and trust the brand. Slow, compounding, hard for competitors to copy.
7. **Mention-vs-citation + sentiment measurement.** *(Build — D7)* Being *recommended* ≠ being *cited*. Track both axes + sentiment per engine; it's the real KPI.
8. **Off-domain consensus moat.** *(Human, tee-up automated — Epic 15)* Mentions beat backlinks ~3:1 for AI; self-serving "we're #1" listicles backfire ~69%. The engine finds gaps and drafts; a human earns the inclusion.
9. **Multimodal (video/YouTube, images).** *(Build — D8)* YouTube is a top-cited AI domain; transcripts + VideoObject + original on-location imagery are under-exploited.
10. **Regulatory surface.** *(Monitor/guardrail)* GDPR on scraping verbatim reviews/PII; FTC review-gating (16 CFR 465); WCAG 2.1 AA for healthcare (live legal lever); never *claim* "ADA compliant." Bake these into `tactics/registry.mjs` as hard blocks.
11. **Fragile dependency tax.** *(Operational)* AI-visibility selector scraping breaks as chat UIs change; small OSS deps (fork + pin); residential proxy upkeep. Budget maintenance time, don't pretend it's set-and-forget.

---

## 8. Risks, guardrails & where the 100x reasoning is weak

Honest caveats (the adversarial-critic pass the workflow couldn't complete due to API overload — written here by hand):

- **DNS is a trust/verification/deliverability lever, *not* a ranking lever.** DNSSEC, CAA, BIMI, DMARC do not directly move rankings. Their value is: domain verification (lights up free GSC/Bing data), email deliverability (makes off-domain outreach land), brand/knowledge-panel trust, and entity binding. Don't oversell DNS as SEO magic — sell it as the *foundation* OTTO can't touch. (The genuine ranking-relevant DNS items are low-TTL failover for crawl reliability and subdomain→subfolder consolidation.)
- **Edge per-bot rendering is one CI bug away from cloaking.** SPLX caught Search Atlas drifting into serving bots different content. Our advantage is *only* real if the parity gate (Epic 3) is enforced and visible text stays byte-identical. Treat the parity test as a release blocker, not a nicety.
- **The moat is not automatable.** Off-domain consensus is the durable AEO win and it's relationship work. The engine's job is discovery + drafting + attribution; a human closes. Plan for one SEO/PR person, not zero.
- **AI content at scale is a penalty risk.** Google's scaled-content-abuse + S-BERT/S-CTS detection demote generated filler (OTTO's own content scored 100% AI-detection). Our guardrail is the anti-slop + per-page unique-data + scale-up-significance gates (Epic 7) — keep them hard. Never mass-publish; gate batch N+1 on batch N's measured lift.
- **"Owning the stack" assumes we own the stack.** True for our directory and owned sites. For client sites the in-house team builds/controls, great. For any client we *don't* control end-to-end, we fall back to the WordPress REST adapter or the Cloudflare-Worker-then-graduate lane — still better than a pure pixel, but acknowledge the dependency.
- **Don't rebuild what's dead or low-value.** No FAQ/HowTo rich-result engineering, no llms.txt optimization machinery, no self-serving listicle/doorway pages (site-reputation-abuse risk), no reciprocal-link networks (WILDFIRE-style footprint). The backlog flags these.
- **Statistical honesty.** The whole autonomy story rests on the significance controller. Respect locked horizons (no peeking), minimum sample sizes (you cannot judge CTR on thin data), and FDR across the batch. "Self-driving" must mean "statistically gated," or it's just OTTO's threshold rollback with extra steps.

---

*Generated from a 47-agent recon (June 2026). Raw findings: [`searchatlas-recon/`](searchatlas-recon/). Full work-unit backlog: [`searchatlas-100x-backlog.md`](searchatlas-100x-backlog.md). Strategy context: [`aeo-deep-research-2026.md`](aeo-deep-research-2026.md), [`inhouse-seo-engine-plan.md`](inhouse-seo-engine-plan.md).*
