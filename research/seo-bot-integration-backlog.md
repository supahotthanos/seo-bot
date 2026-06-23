# seo-bot — new-integration backlog (verified, June 2026)

> From a 44-agent recon (~1.9M tokens) across new SEO/AEO surfaces. Every API below was
> fetched/verified live. Ordered by med-spa AEO value. ✅ = built this pass.

## Microsoft / Bing
- ✅ **Bing Webmaster Tools connector** (`src/data/bing.mjs`, CLI `bing`) — FREE. `GetKeywordStats` = free keyword search-volume (Ahrefs replacement), `GetQueryStats`/`GetRankAndTrafficStats` (Bing-side GSC mirror), `SubmitUrlbatch` (~10k/day). Key: `BING_WEBMASTER_API_KEY`. **Note: ChatGPT Search rides Bing's index (~87% citation overlap) — Bing matters for 2 of 3 AI surfaces.**
- ✅ **IndexNow federation + Bing submit** wired into the orchestrator.
- **Wire Bing into stats/decide** (build-next) — `bingQueryStats` as a second source alongside GSC in the controller.
- **Bing AI Performance** (Copilot/Bing-AI citations of your pages + "grounding queries") — **scraper-only, no API yet** (Microsoft says "during 2026"). Reuse the Scrapling sidecar with a stored BWT session. Fragile/directional.
- **Microsoft Clarity** (`CLARITY_API_TOKEN`) — FREE rage-click/dead-click/JS-error signals (the "why users frustrate" GA4 can't give). 10 req/project/day cap. `GET clarity.ms/export-data/api/v1/project-live-insights`.

## Zero-credential, build-now (free, no keys)
- ✅ **Algo-update monitor** (`src/updates.mjs`, CLI `updates`) — `status.search.google.com/incidents.json`, freezes stats judging during core/spam rollouts.
- ✅ **Internal-link PageRank** (`src/links.mjs`, CLI `links`) — equity-starved money pages + orphans.
- ✅ **Schema lint + rich-result classification** (`src/schema.mjs`, CLI `schema`) — offline JSON-LD lint; **FAQ/HowTo rich results DEAD (May 2026) — flagged not-rewarded**; parse-error + missing-core detection. (Live: caught FAQPage on all 12 nobs pages.)
- ✅ **AI-crawler verification** (`src/connect/aibot-ips.mjs`, CLI `crawlbots`) — fetches vendor IP JSONs (live: 338 CIDRs across GPTBot/OAI-SearchBot/ChatGPT-User/PerplexityBot/ClaudeBot) + UA+CIDR log verification.

## Key-gated connectors (✅ built — graceful no-key; go live when user adds a free key)
- ✅ **GSC URL Inspection API** (`src/inspect.mjs`, CLI `inspect`) — `POST searchconsole.googleapis.com/v1/urlInspection/index:inspect`, scope `webmasters.readonly` (**already held**). Per-URL index status.
- ✅ **PageSpeed + CrUX** (`data/pagespeed.mjs`/`data/crux.mjs`, CLI `cwv`) — `PAGESPEED_API_KEY`/`CRUX_API_KEY` (PSI works keyless at low volume). Lab + field CWV (LCP 2.5s / INP 200ms / CLS 0.1).
- ✅ **Entity consistency** (`src/sources/entity.mjs`, CLI `entity`) — Google KG (`KG_API_KEY`) + Wikidata (no key) → recommended sameAs. (Live: Wikidata query works keyless.)
- ✅ **GBP deeper** (`src/data/gbp.mjs`, CLI `gbp`) — `business.manage` (held); reviews + performance; quota-0 probe; FTC-safe (no sentiment-gating).
- ✅ **a11y** (`src/a11y.mjs`, CLI `a11y`) — static WCAG-AA scan (alt/lang/h1/link-name/button-name/labels/viewport). (axe-core-in-browser is the build-later upgrade for ARIA/keyboard.)
- ✅ **GA4 conversion finish** — `keyEvents` + `eventName` breakdown (booking vs lead vs call); `sessionSource` regex kept as the reliable AI-referral path.
- **GSC Sitemaps write + Discover/News read** (still open) — Sitemaps needs full `auth/webmasters` (read-write) scope → one re-consent.

## Build-later / watch
- Image-SEO (alt autofill + 2-tag image sitemap; before/after stays human-review). VideoObject emitter. YouTube Data API upload (sensitive-scope review). Pinterest Trends (free). Geo-grid map-pack (stealth, Mac Mini). Journalist-request ingest (Featured/Qwoted). Perplexity Sonar API (paid, off by default).

## Skip (verified dead/paid-trap)
- Bing Places API (partner-gated), Microsoft Advertising (SOAP dies Jan 2027; overlaps GetKeywordStats), Merchant Center / free product listings (service business banned; Content API shut Aug 2026), Reddit official API (commercial use barred from free tier), validator.schema.org (no API, maintainer refuses programmatic use), HARO/Connectively (dead).

## 2026 landscape deltas worth knowing
Query fan-out dominates AIO (one prompt → ~9-11 sub-queries; answer the main query + ≥1 sub-query → +161% citation odds). Top-10 share of AIO citations fell 76%→38% (2025→2026) — rank decouples from citation; optimize "answer islands" in the top 30% of the page. FAQ/HowTo rich results dead. Image sitemaps simplified to `<image:image>`+`<image:loc>`. Bing `lastmod` is now a Copilot freshness signal. HHS WCAG 2.1 AA deadline (May 11 2026) passed — a11y is a live legal lever.
