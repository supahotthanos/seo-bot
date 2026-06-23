# seo-bot — feature-gap backlog (50-agent hunt, June 2026)

> From a 59-agent feature-gap audit vs best-in-class tools (Ahrefs/Semrush/Surfer/
> SearchAtlas/LocalFalcon/Profound/seoClarity). ✅ = built this pass.

## Built this pass (quick-wins + the #1 big-build)
- ✅ **techaudit** (`src/techaudit.mjs`, CLI `techaudit`) — real BFS link-crawl: click-DEPTH, full REDIRECT CHAINS (manual hop-by-hop), X-Robots-Tag + meta-robots directives, canonical targets, true orphan reconciliation (guarded to complete crawls), indexability matrix. *Fixed the #1 finding: the crawler was sitemap-only + 40-page sampled.*
- ✅ **GSC striking-distance + cannibalization** (`src/gsc.mjs`, CLI `opps`) — `[query,page]` join → 2+ owned URLs competing; pos-8-20 high-demand queries one nudge from page 1.
- ✅ **CRO booking-funnel audit** (`src/cro.mjs`, CLI `cro`) — tel:/CTA/form-friction/trust raw-HTML audit JOINED with GA4 conversion rate + Clarity frustration. ("highest-dollar gap for an agency paid per booking".)
- ✅ **Cost telemetry** (`src/cost.mjs`, CLI `cost`) — per-client LLM token + spend ledger (was discarding `msg.usage`).
- ✅ **Change-ledger + rollback** (`src/change-ledger.mjs`, CLI `changes`/`rollback`) — journals every apply write with its before-value; the apply layer overwrote blind.
- ✅ **Image SEO + 2026 sitemap** (`src/image-seo.mjs`, CLI `images`) — alt/filename/WebP audit; before/after → human-review (FTC/HIPAA).
- ✅ **Geo-grid local rank** (`src/geogrid.mjs`, CLI `geogrid`) — *"THE deliverable"*: N×N map-pack rank grid, ATRP / SoLV / heatmap (stealth-Maps, deterministic math unit-tested; live fetch needs Mac Mini + residential IP).

## Bigger builds — STATUS
✅ BUILT this pass (user-selected): **(1) Live SERP-feature + AI-Overview inventory** (`src/serp.mjs`, CLI `serp`) · **(2) daily organic rank tracker + Share-of-Voice + competitor rank** (`serp.mjs`, `rank-history.ndjson` + movers) · **(3) multi-location `locations[]` model** (`src/locations.mjs`, CLI `locations`, with doorway-page guard + GBP fan-out + per-location briefs). Live SERP/geo-grid fetch needs the Mac Mini + residential IP; deterministic math unit-tested.

Still open (NOT yet selected for build) — the gap to ~90%+:
4. **Competitor change-feed** — diff measure runs + GSC history → AI-answer movement + new competitor pages + review-velocity alerts, into the existing cron + notify. (medium, free)
5. **Pillar-cluster topical model + hub-and-spoke link gap** — embeddings (transformers.js) cluster pages, diff actual vs ideal intra-cluster links. (medium, free; run on Mac Mini)
6. **Keyword Gap vs competitors** — stealth SERP diff (cfg.competitors stored, never fetched). (medium, stealth)
7. **Migration/redesign workflow** — old-site snapshot, redirect-map gen+validate, before/after crawl-diff (reuses techaudit's ~30 rules). (medium, free)
8. **SEO split-test engine + CausalImpact** — template-bucketed A/B on top of the existing DiD/FDR stats. (large, free)
9. **VideoObject schema + video sitemap** (small, free) · **SOP library → per-client task queue** (medium) · **standalone compliance engine** (FTC/FDA-GLP-1/state-board risk scoring — a vertical product wedge) (large).

## Keyed connectors still open (free key/scope)
- **GSC URL-Inspection → sitemap-vs-index reconciliation** (aggregate coverage ledger; single-URL `inspect` already built).
- **GA4 device+geo+new/returning segmentation** (add dimensions; free).
- **GBP category/attribute/services optimizer** (`business.manage` held — logic only).
- **YouTube Data API audit** (free quota; OAuth pattern exists).
- **Bing GetUrlInfo cross-engine index check** (Bing connector reads index status).
- *Note: GSC Links report has NO public API — backlink data needs UI export or a paid index; gate per `no-paid-api-without-ok`.*

## Skip (verified dead/paid-trap/out-of-scope)
Third-party backlink-index features (paid), AI-content-detector as a publish gate (advisory only), faceted crawl-budget auditing (only binds on large sites), sequential p-values (locked-horizon already sufficient), RealSelf via reputation tools (not natively supported). Sitebulb has no SERP tracking; Ahrefs has no cannibalization report or SERP-overlap clustering; no tool ships an "AI-crawler allow/deny matrix" — all build-it-yourself.

## Completeness verdict (synthesis)
Quick-wins + keyed connectors → ~70-75%, making the **technical-SEO + on-site-AEO + content** surface genuinely best-in-class (the closed audit→propose→apply→measure→rollback loop is something no commercial tool offers). The decisive remaining gap was **local + rank measurement** — now partly closed by the geo-grid. Shipping the big-4 (SERP-feature inventory, daily rank tracker, multi-location, competitor feed) gets it to ~90%+ best-in-class for the vertical; the rest (split-testing, video, compliance engine, SOP platform) are differentiators/moat, not table stakes.
