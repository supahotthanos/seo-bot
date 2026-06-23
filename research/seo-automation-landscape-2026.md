# SEO/AEO automation landscape — steal-and-build (2026-06-22)

> 37-agent survey of 158 real SEO automation tools/capabilities (OSS, SaaS, no-code, Twitter, AI-agents), each verified against our bot. Build FROM this backlog.

## Already covered (we match or BEAT the field — do NOT rebuild)
CONFIRMED we match or BEAT the field (verified in src/ — do NOT rebuild):

STEALTH AI-CITATION TRACKING (our flagship; ahead of every named SaaS):
- Multi-engine stealth capture (ChatGPT/Perplexity/Gemini/SearchGPT/AIO) with per-engine sample targets + noise floors — measure.mjs/measure/prompts.mjs. No paid API = the differentiator AiCMO/Profound/Otterly/elmo/geo-aeo-tracker all lack (they need Vertex/OpenAI keys).
- Visibility/SoV/citation each reported with a Wilson/bootstrap CONFIDENCE INTERVAL + belowNoiseFloor suppression — measure/sov.mjs. Most trackers (and every OSS repo here) quote a single point estimate; CIs are a real edge. Beats Profound/Otterly statistical-sampling claims.
- Graded mention POSITION + 4-quadrant mention-vs-citation split + sentiment — sov.mjs. Deeper than Otterly.
- Cross-provider top-cited-DOMAINS leaderboard + own-brand-ABSENT flag + ranked claimable off-site worklist — sources/index.mjs. This IS Gego/Otterly's domain leaderboard.
- 6-stage measure→sources→serp→crawl→decide chain — stronger grounding than geo-aeo-tracker (Bright Data) and AthenaHQ (Gemini Grounding single-vendor crutch).

ENTITY / SCHEMA (binder + schema-emit already best-in-class on structure):
- Single cohesive @graph with @id cross-references (Organization/MedicalLocalBusiness/WebPage, about→primary, mentions→secondary) — schema-emit.mjs. This IS the Yoast pattern done strictly. VERIFIED in code; the brief's claim we lack about/mentions is INACCURATE.
- sameAs → Wikidata/KG/socials on org + every entity node (the "non-negotiable for LLM search" lever) — schema-emit.mjs + sources/entity.mjs. Already a named lever.
- about/mentions primary-vs-secondary topic split — already emitted (InLinks pattern).

CRAWL-BUDGET / LOGS (at parity with Oncrawl/JetOctopus, and OTTO can't do logs at all):
- Crawl × log JOIN finding true orphans + crawl-starved pages; per-template waste% with faceted/param flagging; urlTemplate() segmentation — crawlbudget.mjs. The Oncrawl/JetOctopus crawl-budget engine, already built.
- CIDR-verified bot IP ranges (GPTBot/SearchBot/Perplexity/Claude offline JSONs) — connect/aibot-ips.mjs.

INTERNAL LINKING (we LEAD; only the GSC-mismatch + community-detection adds are missing):
- Reasonable-surfer weighted PageRank + greedy sculpt targeting below-median money pages/orphans/depth>3 + topical mesh + entropy-constrained LLM anchors from target title/H1 — pagerank-weighted/sculpt/mesh/anchors. More shippable+reversible than WebKnoGraph's GNN for med-spa-sized sites. Full-body embedding (not title/H1) already done.

DECAY / GSC OPPORTUNITY:
- content/decay.mjs (GSC two-window click diff, residual-demand floor, severity×recovery×business-value, vetoes date-only refreshes) — STRONGER than Zapier/agentic-seo-agent triggers.
- gsc.mjs striking-distance (pos 8-20, impr≥30), low-CTR opportunities, cannibalization join, BYO-key cost model — beats Cuppa/n8n opportunity-agent (which use paid SerpApi/DataForSEO).

CONTENT SCORING (range/over-use already done):
- True Density placement-weighted term scoring (title 5x/H1 4x/intro 2x) — score.mjs. Surfer's mechanic, built.
- Bounded term RANGE [p25,p75] with under/in-range/OVER state + 0.7 over-use credit — terms.mjs+score.mjs. This IS NeuronWriter's overuse-red. Built.
- df/N consensus already factors into term ordering — terms.mjs.

GEO METHOD SCORING:
- aeo.mjs already scores statistics/quotation/cited-source density + keyword-stuffing penalty grounded in the SAME KDD'24/Princeton GEO paper, + ≤17-word capsule + question headings. Core 47-signal rubric overlaps.

EDGE DEPLOYMENT (we have the BETTER version of OTTO):
- apply/cloudflare-worker.mjs server-side HTMLRewriter edge rewrite (seen by non-JS AI bots) — strictly superior to OTTO's JS pixel; streaming-bug guarded, idempotent. change-ledger = structured changeset + rollback. middleware-codegen graduates to source PR.

PLATFORM:
- Dep-free MCP stdio server — mcp-server.mjs (have it; OpenSEO/Local Falcon parity).
- Health Score per category (report.mjs/portfolio.mjs weighted blend) — Lumar/SEOMachine score, built.
- AI-crawler robots.txt barrier audit (GPTBot/SearchBot/Claude/Google-Extended/CCBot) — crawl.mjs. Writesonic's GEO-barrier check, built.
- Free Clarity friction pull (rage/dead/quick-back/scroll) joined into CRO — data/clarity.mjs. Built.
- Evidence-collector firewall (deterministic findings → decide.mjs LLM reasons only over them) — Agentic-SEO-Skill's pattern, already our architecture.
- URL Inspection API per-URL index poll — inspect.mjs (the Apps-Script gist is a poor-man's version).
- DataForSEO coordinate contract + ATRP/SoLV/coverage math — geogrid.mjs.

## Best-in-class map (best tool per function + do we match)
Best tool per SEO function + do we match it:

CRAWL/AUDIT ENGINE → Screaming Frog / Sitebulb (commercial) · OSS: SiteOne Crawler, SEOnaut, open-seo-crawler. WE MATCH the engine (~30 rules + med-spa pack + techaudit BFS). MISSING: Sitebulb's head-corruption hints (<noscript>/invalid-element-in-<head>, canonical HTML-vs-HTTP-header mismatch, meta-robots-outside-head) [#33-area in hints], SiteOne's CI gate [#10], Greenflare custom extractors [#55].

PROGRAMMATIC PAGE GENERATOR → SEOmatic / AirOps Grid (SaaS) · OSS: pseo-next (VERIFIED canonical), PageForge, programmatic-seo-engine, Cult Directory Template. WE DO NOT MATCH — #1 gap, the highest-value build. [#1]

CI/CD SEO REGRESSION GATE → Lumar Protect (SaaS) · SiteOne Crawler (OSS, exit-10 VERIFIED). WE DO NOT MATCH. Highest-ROI safety build for a directory. [#10]

AI-VISIBILITY / CITATION TRACKING → Profound / Otterly / Bluefish (SaaS) · OSS: geo-aeo-tracker, Gego, elmo, geo-optimizer-skill. WE MATCH AND BEAT on grounding (stealth no-API capture + CIs + noise floor). MISSING: passage-level attribution [#42], Camoufox auth capture [#40], recommendation-TYPE enum [#41], versioned-locked prompt set [#44].

GEO-GRID / LOCAL MAP-PACK → Local Falcon (SaaS) · OSS: danishfareed/Google-Maps-SERP, gosom/google-maps-scraper. WE MATCH the ATRP/SoLV math; MISSING per-pin stealth context+GPS spoof, grid modes, competitor SoV/HHI, hidden secondary-category scrape. [#27-31]

CONTENT OPTIMIZATION SCORE → Surfer / Clearscope / MarketMuse / NeuronWriter (SaaS) · OSS: SEOMachine. WE MATCH True-Density + bounded range/over-use. MISSING: BM25 saturation math [#15] (which BEATS all of them), readability axis [#16], entity-gap score [#18].

INTERNAL LINKING → InLinks / Link Whisper (SaaS) · OSS: WebKnoGraph, ContextBridge, txtai, Internal Link Juicer. WE LEAD (weighted PageRank + greedy sculpt + entropy anchors + full-body embeddings). MISSING: GSC-mismatch anchor pairs [#22], community-detection missing-edges [#23], hybrid dense+sparse + intent gate [#24].

SCHEMA / STRUCTURED DATA → Schema App / WordLift (SaaS) · OSS: google/schema-dts, adobe/structured-data-validator, schemarama, schema-org. WE MATCH the @graph/about/mentions/sameAs EMIT. MISSING the validation triad: authorship typing + field-level errors + per-template SHACL contract. [#33-35]

ENTITY / KG → InLinks / WordLift / Kalicube (SaaS) · OSS: spaCyfishing, OpenRefine reconciliation, QuickStatements. WE MATCH emit/binder/sameAs. MISSING: confidence-scored reconciliation [#51], nerd_score NER [#52], KG resultScore KPI + corroboration loop [#50].

CRAWL-BUDGET / LOG ANALYSIS → Oncrawl / JetOctopus / Botify (SaaS) · OSS: advertools, oncrawl-elk, goodbots. WE MATCH the crawl×log engine + per-template waste. MISSING: authoritative rDNS confirm [#36], AI-bot health [#37], per-segment funnel [#13].

OFF-SITE / DIGITAL PR → Pitchbox / MentionAgent (SaaS) · OSS: news-please, Fundus. WE DO NOT MATCH (worklist-not-executor). Build unlinked-mention + RAG-pitch + link-monitor. [#46-49]

CONTENT DECAY / GSC OPPORTUNITY → BrightEdge / seoClarity (SaaS) · OSS: agentic-seo-agent, Suganthan BigQuery MCP. WE MATCH AND BEAT (decay.mjs + striking-distance + stats rigor). MISSING only: drop-cause decomposition [#69], anti-words/voice-clone [#19].

CRO / UX FRICTION → Microsoft Clarity (free) · OSS: clarity-mcp-server. WE MATCH aggregate friction pull. MISSING: per-page session-recording retrieval [#67].

AUTOPILOT / ORCHESTRATION → BrightEdge Autopilot / seoClarity Sia (SaaS). WE have all pieces (EV rank + apply + change-ledger + stats guardrails) but MISSING the auto-apply trust gate + director planner. [#57-58]

PACKAGING / DISTRIBUTION → OpenSEO / claude-seo (9.4k stars, OSS skills). WE MATCH the MCP server + evidence-collector architecture. MISSING: SKILL.md wrappers, wildcard rule config, PDF/XLSX export, broader MCP tool surface. [#60]

## Steal-and-build backlog (ranked, mapped to our modules)
RANKED missing/partial capabilities to build. Format: capability | source | our-module-to-add/extend | impact | effort.

P0 — THE GENERATOR CLUSTER (one build unlocks ~10 downstream steals; verified absent: no generate/brief/outline module in src/)
1. Dataset-row→page GENERATOR with idempotent write-back state | pseo-next (agamm, github.com/agamm/pseo-next), AirOps Grid, SEOmatic, PageForge, Cult Directory Template | NEW seo-bot/src/generate/pages.mjs (reads data/ + Supabase rows → Next.js [slug] route + generateStaticParams + generateMetadata + per-row JSON-LD via entity/schema-emit; calls index-discipline.decideIndex() per row; status/URL written back for resumable re-runs; ships via apply/nextjs PR) | CRITICAL (the #1 known gap; unlocks city-listicle/cost-table/comparison at once) | L
2. Archetype dispatch table (intent-type → section skeleton + schema + asset rules) | SEObot (typed format taxonomy), kostja94/aaron-he-zhu 40+ page types | EXTEND content/templates.mjs into the generator's dispatch table; add listicle/versus/howto/citypage/stats archetypes (sections[]+schemaTypes[]+assetRules) | HIGH (the data half of the generator) | M
3. Batch/pSEO quality LINTER (cross-page near-dup, value-add density, slug dedup) run on the emitted BATCH before publish | AirOps similarity gate, PageForge slug-dedup, pseolint concept | NEW generate/pageset-lint.mjs reusing mesh.mjs cosine + locations.mjs doorway-guard + corpus similarity; refuse PR if batch exceeds dup threshold | HIGH (keeps {service}×{city} matrix off SpamBrain) | M
4. {service}×{city} MATRIX expansion, gated to cells with real spa data | programmatic-seo-engine, AirOps | generate/geo-matrix.mjs over locations.mjs services×cities; require ≥N real spas + real photos/reviews per cell before generating | HIGH | M
5. SERP-grounded deterministic content BRIEF (median word count, term table from top-10, Flesch band, required H2s) | Semrush Content Template, Frase, Clearscope, Surfer | NEW content/brief.mjs over corpus.mjs (already fetches top-10 + headings) → typed Brief JSON; gates.mjs scores draft AGAINST brief | HIGH (the spec the generator is held to) | M
6. SERP-derived OUTLINE synthesizer (cluster competitor H2/H3 union → coverage-gap skeleton) | Frase, n8n #5985, Conductor | NEW content/outline.mjs consuming headings corpus.mjs ALREADY collects (optimize.mjs only uses term table today) | HIGH (score→generate bridge) | S
7. Build-time per-page OG/hero image generator from row data + real photo | santifer-irepair pattern (Astro+Airtable) | NEW generate/og-images.mjs via satori/@vercel/og (confirmed absent: no satori/@vercel/og in src/); composite our ~3.2k real spa photos; enforce via image-seo audit | MED | M
8. Event-driven generator WATCH mode (new/changed scraped row → draft PR; self-extending directory) | Relevance AI SEO agent | NEW generate/watch.mjs diffing scrape manifest hash → enqueue draft via integrity confidence-gate; wire to existing cron | MED (depends on #1) | S
9. WordPress bulk generator (CSV/token→posts via REST) | MPG/PageForge (WP) | EXTEND apply/wordpress.mjs (currently update-only, keyed by wpPostId) with create-from-template mode through gates+doorway-guard | MED (only if WP clients) | M

P0 — INDEX-DISCIPLINE & CI GATE (named known gap; verified: no gate/exit-code, no llms.txt)
10. Pre-deploy CI REGRESSION GATE that fails build on Critical-hint increase (e.g. "this PR adds noindex to 4,000 pages", canonical flips, sitemap shrink) + reserved exit code 10 | SiteOne Crawler (--ci, exit 10, VERIFIED), Lumar Protect, Schemar | NEW src/gate.mjs reading cfg.gate{minScore,maxCritical,maxErrors}; GitHub Action / Vercel predeploy crawls preview, diffs vs change-ledger baseline | CRITICAL (template-CWV + index-discipline enforcer, two gaps at once) | M
11. Closed-loop index state machine (lastmod → GSC URL-Inspect verify → submit-only-if-not-indexed → 7-day dedup cache) | n8n #11979, Draft Horse (index-as-pipeline-stage) | WIRE index-discipline.mjs + inspect.mjs + indexnow.mjs (all exist, not chained); add submitted-URL TTL cache (mirror corpus.mjs TTL) + index-coverage ledger (submitted≠confirmed) | HIGH (closes partial index-discipline) | S
12. Codebase→GSC reconciliation (emitted-but-not-indexed vs GSC-query-without-page) | serpiq | NEW reconcile.mjs: enumerate generator route map → left-join inspect.mjs + gsc.mjs | MED | S
13. Per-segment FUNNEL (crawl→bot→indexed→click %retained per template) | JetOctopus/Oncrawl | NEW funnel.mjs left-joining crawl ⋈ logs ⋈ GSC by urlTemplate() (already exists in crawlbudget) | HIGH (localizes index failure to one template) | M
14. llms.txt detect/validate/emit + adoption TRACKER across our ~thousands of spa domains | seo-analyzer, llms-txt-toolkit (abovefear), GEO Optimizer Skill | NEW llms.mjs (fetch+lint /llms.txt as audit finding; emit from sitemap via apply/nextjs; adoption check = sales lead signal) | HIGH (AEO file we don't produce; verified zero hits) | S

P1 — CONTENT SCORING MATH (mostly surgical edits to existing files)
15. BM25 saturation term-credit + zero-score cliff for missing high-IDF terms | Search Engine Land BM25 article | EDIT content/score.mjs (replace linear credit) + terms.mjs (flag top-decile-IDF missing terms as CRITICAL; idf already computed) | HIGH (mechanistically correct vs Surfer/Frase density) | S
16. Readability axis + 6-component score decomposition | SEOMachine (MIT, portable Flesch) | NEW content/readability.mjs (Flesch/Kincaid/passive/sentence-len) + split score into content/keywords/meta/structure/links/readability | MED | S
17. Consensus-forward term importance (1-10 from df/N, not raw TF-IDF) | Clearscope | EDIT terms.mjs: importance=tfidf*(df/N)^p; feed into score.mjs coverage | MED | S
18. Entity-coverage gap score (entities in ≥N of top-10 but absent from draft) | Rankability, MarketMuse (KG fusion) | EXTEND score.mjs with entityCoverage using entity/extract.mjs over competitor bodies; fuse entity/graph KG into topicmodel | MED | M
19. Anti-words AI-cliché banlist + brand-voice cloning from client's top GSC pages | agentic-seo-agent (Dominien) | ADD gates.mjs banlist check + voice-profile step feeding optimize.mjs | MED (cheap quality lift) | S
20. LLM reflection/critic pass (separate adversarial reviewer before publish) | Multi-Agent-SEO-Blog-Generator | ADD critique step after llmDraft, before scoreContent, one revise loop, gated | MED | S
21. Real-demand query harvest (alphabet-soup autocomplete + recursive PAA tree) | EcommerceTools google_autocomplete, sundios/people-also-ask | ADD to Scrapling sidecar: suggestqueries endpoint + recursive PAA BFS depth 2-3 → feed fanout.mjs + generator + faq answer-islands | HIGH (grounds fanout in real demand; feeds generator) | M

P1 — INTERNAL LINKING (we already lead here; targeted adds)
22. GSC query→page mismatch → precise internal-link {source=ranking-page, anchor=query, target=desired-page} | Screaming Frog + embeddings (iPullRank); SF related-pages | NEW step joining gsc.mjs cannibalization (emits list only) + money-page map → sculpt-compatible candidates | HIGH (most concrete steal; turns GSC demand into anchors) | S
23. Community-detection missing-edge worklist + 4-way starved-page predicate (deep depth ∧ low PageRank ∧ indexable ∧ has impressions) | importSEM NetworkX, Sitebulb URL-Rank hint | ADD Louvain (~40 lines, no NetworkX) over links.mjs graph + join pagerank ⋈ gsc impressions | MED | M
24. Hybrid dense+sparse link scoring + same-intent category GATE + 0.78-0.85 band (upper redundancy ceiling) | ContextBridge, iPullRank thresholds | wire mesh candidates through rrf.mjs (we have it); add URL/template intent-bucket gate; add upper ceiling to mesh.mjs (only has floor today) | MED | S
25. Segment-level link-equity FLOW (which template hemorrhages PageRank to non-indexable) | Oncrawl InRank Flow | NEW inrankFlow.mjs aggregating pagerank edges by urlTemplate() inflow/outflow | MED | M
26. Stateful cluster link-graph (re-wires on spoke add/delete) | Penfriend Cluster | persist cluster manifest (hub+spokes+edges); mesh re-derives only affected edges via change-ledger diff | MED (pairs with generator) | M

P1 — LOCAL / GEO (geogrid exists; add competitor + grid modes)
27. Competitor Share-of-Voice + HHI concentration across grid pins | GBP Rank Tracker (danishfareed/Google-Maps-SERP) | ADD competitorSoV()/HHI to geogrid.mjs reusing parseMapNames() | HIGH (directly sellable; reuses parsed data) | S
28. Per-pin isolated browser context w/ GPS+timezone+locale spoof + grid modes (square/circle/ZIP/smart) | danishfareed, gosom/google-maps-scraper (-grid-bbox) | NEW geogrid-scan.mjs spinning fresh Playwright context per pin via stealth.mjs; add buildBboxGrid(); vendor offline postal DB for smart mode | HIGH (biggest local accuracy gap) | L
29. Geo-aware AI visibility (SAIV: run "near me" queries from each pin's geo across AI engines) | Local Falcon SAIV | NEW measure/ metric joining grid pins to AI-engine queries | HIGH (unifies map-pack + AI-citation; differentiation) | M
30. Hidden GBP secondary-category + Place ID/CID extraction → "category gap" audit rule | GMB Everywhere | ADD GBP-payload parser in stealth fetch → med-spa pack rule | HIGH (top GBP lever nobody scrapes) | M
31. GBP Guard (daily diff of category/hours/name/website) | Local Falcon Falcon Guard | ADD to connect/google.mjs GBP OAuth: snapshot+diff → change-ledger alert | MED | S
32. Post-geogrid event trigger → auto work-order on SoLV/ATRP regression | Local Falcon n8n | ADD orchestrator hook diffing vs last run, gated by stats guardrails | MED | S

P1 — SCHEMA HARDENING (verified: schema.mjs is lint-only + hand-built JS literals)
33. Type-checked schema at authorship (schema-dts dev-dep typed builders) | google/schema-dts | dev-dep + typed builders in entity/schema-emit + directory profile pages | HIGH (won't compile invalid spa schema; left-shifts validation) | M
34. Field-level validator errors (path+field+severity for precise auto-fix) | adobe/structured-data-validator (JS-native) | wire into schema.mjs → decide.mjs gets exact bad-field path | HIGH (enables field-level schema patches) | S
35. Per-template SHACL/ShEx CONTRACT (spa-profile MUST have name+address+geo+priceRange+sameAs[]+aggregateRating) | google/schemarama | one shape per template, validate in techaudit BFS | HIGH (template contract = generator schema spec) | M

P1 — CRAWL-BUDGET / LOGS (crawlbudget strong; close evidence gaps)
36. Authoritative rDNS→fwd-DNS bot confirmation (close "trust-UA" spoof hole for Googlebot/Bing) | goodbots/googlebot-verify | ADD dns.reverse→resolve to connect/aibot-ips.mjs for JSON-miss case; tighten IPv6 CIDR | HIGH (removes spoofed-Googlebot hole) | S
37. AI-bot health audit (GPTBot/ClaudeBot/PerplexityBot status codes — 403/404 only-hurting-AI) | Writesonic GEO, Scrunch | NEW report over connect/logs.mjs ⋈ aibot-ips verified bots; alert AI-bots-worse-than-Googlebot | HIGH (silent citation killer) | S
38. 3-bucket bot taxonomy (train/retrieve/index) + retrieve-share trend → join to citations | digitalapplied log-segmentation | botClass() map + retrieve-share timeseries → measure (crawl→cite observed) | MED | S
39. logs errors-quarantine sink + columnar (Parquet/DuckDB) cache | advertools logs_to_df | ADD errors NDJSON sink + optional DuckDB over NDJSON to connect/logs.mjs | MED | S

P1 — MEASURE / AEO (citation tracking already leads; targeted upgrades)
40. Camoufox authenticated-session capture (survives ChatGPT/Gemini sign-in loops; stock Chromium gets blocked per our own comments) | OneGlanse | ADD Camoufox driver as new fetch mode to measure.mjs/stealth | HIGH (current path bot-blocked) | M
41. Recommendation-TYPE enum (top-pick/alternative/conditional/mentioned/discouraged/absent) + 4-axis composite GEO score | OneGlanse | EXTEND measure/sov.mjs classifier + composite | MED | S
42. Passage-level citation ATTRIBUTION (answer-span ⋈ cited-page passages → "this paragraph won the citation") | Bluefish AI | NEW measure/attribution.mjs reusing passage.chunkPage + rrf.cosine on real captures | HIGH (makes "replicate winning structure" literal) | M
43. Stale-cache + outdated-fact detector on cited pages → freshness IndexNow ping | Scrunch | ADD to crawl-to-cite.mjs (diff lastmod/hash vs cited snapshot) + content/staleness.mjs | MED | M
44. Hardened AIO extraction (heading-anchored selectors + wait-and-retry for flicker) + locked versioned prompt set | serpapi AIO scraper, Profound Index | centralize AIO selectors in constants; freeze promptset.vN.json with version stamp on every SoV datapoint | MED | S
45. Per-page broadened GEO sub-scores + ai.txt + /ai/summary.json emitter | GEO Optimizer Skill (KDD'24) | aeo.mjs already scores 4 signal families — broaden + report sub-scores; emit ai.txt/summary.json via apply/edge+cloudflare-worker | MED | S

P1 — OFF-SITE EXECUTOR (named gap: "worklist-not-executor")
46. Unlinked-mention detector (brand_NER_hit ∧ no resolving href) | Ahrefs/SF pattern | NEW offsite/unlinked.mjs combining entity/extract (NER+aliases) + crawl/links href-resolve | HIGH (cheapest defensible build; powers everything below) | S
47. RAG-grounded PR pitch (quote ONLY claims on client pages w/ canonical URL; drafts-not-sends) | n8n HARO responder, MentionAgent, Optimo | NEW offsite/pitch.mjs over crawl store + integrity confidence-gate → human_review bucket (reuse credibility routeProposal) | HIGH (turns worklist into executor for the safe channel) | M
48. Author/byline + date extraction for journalist-level targeting | news-please (MIT), Fundus (per-publisher registry) | news-please Python sidecar alongside fetch.py → author rows feed offsite targets | MED | M
49. Post-placement link MONITORING (link still live/dofollow/anchor intact; alert on decay) | Pitchbox | NEW offsite/link-monitor.mjs reusing techaudit status/redirect checking + change-ledger | MED | S

P1 — ENTITY (schema-emit/binder strong; fix accuracy + emit batch)
50. Confidence Score (KG resultScore) as tracked KPI + corroboration audit (sameAs targets point back to Entity Home) | Kalicube Process | EDIT sources/entity.mjs to capture itemListElement[0].resultScore (one line; already calls endpoint); append to entity-graph.json timeseries; NEW corroboration-check | HIGH (one-line capture; turns brand-authority into movable number) | S
51. Type-constrained reconciliation (name+type+P131 → scored QID, kills wrong-match) | OpenRefine Reconciliation API | EDIT sources/entity.mjs (replace search[0] top-hit with scored reconcile; gate auto-bind on score) | HIGH (fewer false entity matches; ~40 lines) | S
52. Self-hosted NER→QID with per-mention nerd_score | spaCyfishing/entity-fishing (free, local) | entity-fishing Docker on Mac sidecar; Node client posts crawled text → {mention,qid,score}; gate emit ≥0.6 | HIGH (keyword-match→confidence-scored, no spend) | M
53. QuickStatements batch-edit emitter (source-attributed Wikidata facts) | QuickStatements 3.0 | ADD emitQuickStatements() to entity walk; human-submitted | MED | S
54. Canonical /entity/{slug} site-level @id namespace (reference-not-redefine recurring topics) | WordLift/SEOntology | EXTEND entity/graph.mjs to mint /entity/ URIs; schema-emit references them | MED | M

P2 — ORCHESTRATION / PLATFORM / DELIVERY
55. Custom-extraction columns (config-driven CSS selector → site-wide column) | Greenflare (gflare-tk) | ADD cfg.extract=[{name,selector,attr}] to crawl.mjs (cheerio already dep) | HIGH for directory (config-driven price/hours/services harvest) | S
56. Auto-loading PLUGIN architecture (drop-in /plugins/*.mjs rule packs) | LibreCrawl | define stable crawl-data contract; audit.mjs globs plugins; merge findings | MED (ships per-vertical packs without forking) | M
57. Autopilot mode (auto-apply above EV+confidence threshold, guardrail auto-rollback) | BrightEdge Autopilot, seoClarity Sia | NEW orchestrate/autopilot.mjs over priority + edge adapter + stats guardrail + change-ledger; opt-in per safe rule class | MED | M
58. Director planner (read situation → dispatch which modules, in what order) | n8n hierarchical swarm | thin planner above orchestrator runLoop; execution stays deterministic | MED | M
59. IFTTT rule layer + issue-id→pages inverse index (batch-fix executor) | seoClarity, Ahrefs API | emit issues.json keyed by issueId→[urls]; small when/where/do DSL routing to apply | MED | M
60. Audit SKILL packaging + wildcard rule config + XML/PDF/XLSX export + MCP breadth | seo-audit-skill, claude-seo (PDF/XLSX), OpenSEO (MCP) | SKILL.md wrappers; cfg.audit.disableRules glob; export/ (Playwright print-to-PDF + SheetJS); surface ~100 modules as MCP tools | MED (distribution/white-label leverage) | M
61. Cost PRE-RUN estimator (price a planned geogrid/serp run before launch) | open-seo cost estimate | ADD estimate(plan) to cost.mjs (post-hoc today); surface in work-order | MED | S
62. SERP-provider router (stealth default + opt-in paid backends, normalized envelope) | SerpBear, OpenSERP | NEW serp-providers/ decoupling parse from acquisition (Google DOM change breaks all today) | MED | M
63. Captcha/proxy failover chain + HTTP→browser escalation ladder + blocked-stop signal | Serposcope, Botasaurus, OpenSERP | ADD CaptchaSolverChain + ProxyPool + escalate() to stealth.mjs (free-first per memory) | MED (makes geogrid/serp usable from datacenter IP) | M
64. Persistent per-client/per-location living BRIEF markdown (compounding history; "why did rankings drop in March?") | garrettjsmith/localseoskills | NEW briefs/<client>/ ledger appended by each run; gitignored | MED (strong narrative-memory steal) | S
65. Falsifiability field on every fix proposal ({failureCheck, leadingIndicator}) + Confirmed/Likely/Hypothesis confidence label | Agentic-SEO-Skill, claude-seo | ADD to decide.mjs proposal shape; auto-register stats guardrail; enforce confidence label in finding schema | MED (trust/auditability) | S
66. Module whitelist (ENABLED_MODULES) on MCP/orchestrator | DataForSEO MCP | ADD enabledTools[] to config; filter in mcp-server | LOW-MED (cost/blast-radius primitive) | S

P2 — REPORTING / CRO / DECAY (mostly wiring; engines already strong)
67. Per-page Clarity session-recording retrieval (exact failing sessions behind a leaking money page) | microsoft/clarity-mcp-server | ADD clarityRecordings(url,event) — data/clarity.mjs is aggregate-only today | MED (grounds CRO fixes in real sessions) | S
68. CTR↔position correlation health check (weak corr → title/meta CRO opportunity) | aliasoblomov BigQuery-GA4 | NEW correlation() over gsc byQueryPage → decide title/meta rewrite | MED | S
69. Traffic-drop decomposition (rank vs CTR vs demand loss) + 3-consecutive-window decay rule | Suganthan BigQuery MCP | ADD attribution to content/decay.mjs (clicks=impr×CTR diff per factor) | MED | S
70. Per-channel GA4 z-score anomaly (organic-only drop not masked) + single digest | n8n GA4 anomaly | ADD channel dimension to data/ga4.mjs + significance.mjs z-test (already exists) | MED | S
71. Decay-trigger auto-spawn structured work-order; striking-distance fan-out to generator/decay | Zapier, agentic-seo-agent, n8n opportunity agent | wire decay.mjs + gsc.strikingDistance (both exist) → tasks/work-order routing | MED (wiring only) | S
72. Render-time keyword→target link INDEX w/ per-target cap (one-row reversible edits) | Internal Link Juicer | make apply/edge the default for internal links; store index {kw→target, maxPerTarget} | MED (we cap per-source not per-target) | M

## Quick wins (small edits, build now)
Small, high-value, mostly edits to existing files (S effort) — build NOW:

1. CI GATE w/ exit code 10 (src/gate.mjs) — SiteOne pattern; we already compute score+bySeverity. Drop into Vercel/GH-Action predeploy. The missing teeth on scoring we already preach. [#10]
2. KG resultScore capture — ONE LINE in sources/entity.mjs (already calls the KG endpoint, just doesn't read itemListElement[0].resultScore); append to timeseries → movable entity KPI. [#50]
3. Type-constrained Wikidata reconciliation — ~40 lines swapping search[0] top-hit for scored reconcile; kills wrong-entity matches. [#51]
4. GSC query→page mismatch → precise {source,anchor=query,target} internal-link jobs — join gsc.mjs cannibalization (emits list only today) + money-page map. Single most concrete steal in the linking category. [#22]
5. llms.txt detect+validate+emit + adoption tracker across our thousands of spa domains (turnkey sales lead signal) — verified zero hits in src/. [#14]
6. BM25 saturation term-credit + zero-score cliff — localized edits to score.mjs + terms.mjs (idf already computed); mechanistically beats Surfer/Frase density. [#15]
7. rDNS→fwd-DNS bot confirmation in aibot-ips.mjs — closes the spoofed-Googlebot "trust-UA" hole. [#36]
8. AI-bot health audit (GPTBot/ClaudeBot 403/404 only-hurting-AI) over connect/logs.mjs ⋈ verified bots — silent citation killer. [#37]
9. Competitor SoV + HHI across geogrid pins — reuses parseMapNames() already in geogrid; directly sellable. [#27]
10. Index state-machine wiring — chain index-discipline + inspect + indexnow (all exist, not chained) + 7-day TTL cache. [#11]
11. SERP-derived OUTLINE synthesizer — corpus.mjs ALREADY collects competitor headings; optimize.mjs just ignores them. score→generate bridge. [#6]
12. Anti-words banlist in gates.mjs + falsifiability field {failureCheck,leadingIndicator} on decide proposals. [#19,#65]
13. Custom-extraction columns cfg.extract in crawl.mjs (cheerio already dep) — config-driven price/hours/services harvest for the directory. [#55]
14. Per-page Clarity session-recording retrieval (data/clarity.mjs is aggregate-only) — grounds CRO fixes in real failing sessions. [#67]
15. CTR↔position correlation flag → title/meta CRO opportunity. [#68]
16. Cost pre-run estimator estimate(plan) in cost.mjs (post-hoc today). [#61]
17. Per-client/per-location living-brief markdown ledger (gitignored) — "why did rankings drop in March?" narrative memory. [#64]

## Bigger builds (ranked)
Larger steals worth doing, RANKED by leverage (M-L effort):

1. THE PAGE GENERATOR (generate/pages.mjs) — #1 known gap, verified absent. Row→Next.js [slug] page with generateStaticParams + per-row JSON-LD (via existing schema-emit) + index-discipline gate + idempotent write-back, shipped as apply/nextjs PR. Reference: pseo-next (agamm, VERIFIED real+canonical), AirOps Grid, SEOmatic, PageForge. This single build unlocks city-listicle/cost-table/comparison generators AND is the dependency for the brief, PAA-tree, matrix, OG-image, watch-mode, and AEO-gap-closer steals. Pair with archetype dispatch (extend templates.mjs) + batch pSEO-lint (mesh cosine + doorway-guard) so the {service}×{city} matrix stays off SpamBrain. [#1-9]

2. PRE-DEPLOY REGRESSION GATE / LUMAR PROTECT (gate.mjs + GitHub Action) — crawl preview, diff indexability vs change-ledger baseline, FAIL build on Critical increase ("PR adds noindex to 4,000 pages", canonical flips, sitemap shrink). Closes BOTH template-CWV-enforcer and partial-index-discipline named gaps. Highest-ROI safety check for a directory at scale. [#10]

3. PER-PIN STEALTH GEO-GRID SCANNER (geogrid-scan.mjs) — isolated Playwright context per pin with GPS+timezone+locale spoof (we only vary the Maps URL today = weak signal), + square/circle/ZIP/smart grid modes + bbox tiling to beat the 120-result cap. Vendor the offline postal-code DB for smart mode. Our biggest LOCAL accuracy gap. Reference: danishfareed/Google-Maps-SERP, gosom/google-maps-scraper. [#28]

4. SCHEMA CONTRACT TRIAD (highest-value cluster for us): schema-dts typed builders (authorship-time, won't compile invalid spa schema) + adobe/structured-data-validator (field-level path errors → precise auto-fix) + schemarama SHACL/ShEx per-template contract (spa-profile MUST have name+address+geo+priceRange+sameAs+aggregateRating). Turns schema from "lint post-hoc" into "contract-enforced," and the SHACL shape IS the spec the generator must satisfy. [#33-35]

5. OFF-SITE EXECUTOR (offsite/unlinked.mjs + pitch.mjs + link-monitor.mjs) — closes the named "worklist-not-executor" gap. Unlinked-mention detector (NER ∧ no-href, reuses entity/extract + crawl) → RAG-grounded pitch quoting ONLY claims on client pages w/ canonical URL (reuses integrity confidence-gate, drafts-not-sends) → post-placement link monitor (reuses techaudit status checks). All local-compute, no paid API. Reference: n8n HARO responder, news-please (author extraction), Pitchbox, MentionAgent. [#46-49]

6. PASSAGE-LEVEL CITATION ATTRIBUTION (measure/attribution.mjs) — align real captured AI-answer spans to cited-page passages (reuse passage.chunkPage + rrf.cosine) → "THIS paragraph won the citation; replicate its structure." Turns binary cited/not into actionable structural edits. Reference: Bluefish AI. [#42]

7. CAMOUFOX AUTHENTICATED CAPTURE — swap stock Chromium (our own comments admit it gets bot-blocked) for Camoufox anti-fingerprint Firefox on logged-in ChatGPT/Gemini. Reference: OneGlanse. [#40]

8. PER-SEGMENT FUNNEL (funnel.mjs) — crawl→bot→indexed→click %retained per template; "city pages: 100% crawled, 90% bot, 12% indexed" instantly localizes index-discipline failure. Reference: JetOctopus/Oncrawl. [#13]

9. SELF-HOSTED NER→QID with confidence (entity-fishing Docker on Mac sidecar) — upgrades the gazetteer extractor to confidence-scored Wikidata linking, no spend, gate emit ≥0.6. Reference: spaCyfishing. [#52]

10. AUTOPILOT mode + DIRECTOR planner — auto-apply above EV+confidence threshold with guardrail auto-rollback (opt-in per safe rule class) + situation-aware module dispatch. Reference: BrightEdge Autopilot, n8n hierarchical swarm. [#57-58]

## Not worth it (skip — with reasons)
Popular-but-SKIP (hype / paid-trap / dead / out-of-scope / we already beat it):

- FAQPage schema emission — DEPRECATED May 2026; faq_cluster template already correctly emits answer-islands WITHOUT FAQ rich schema. Steal the grounded generate→QA-verify MECHANIC for AEO answer-islands, NOT the dead schema. (patil-suraj question_generation — use Claude not T5.)
- txtai unified dense+sparse+graph store — Python service + persistent store + embedding-model dependency violates our zero-dep/offline-first posture; community-detection payoff is small for med-spa-sized sites. Architecture reference only; if ever wanted, a ~40-line Louvain pass over the graph we already build in-process. [verification: missing/not-worth-it]
- GraphSAGE GNN link prediction (WebKnoGraph) — needs PyTorch training data on the Mac; our greedy weighted-PR sculpt is more shippable+reversible and adequate at our scale. Optionally borrow HITS hub/authority scoring into sculpt; skip the GNN. [verification]
- spatie/schema-org code-gen — PHP, wrong ecosystem; the auto-sync-to-schema.org benefit comes FREE by depending on schema-dts (whose schema-dts-gen IS that generator, run by Google). Don't port. [verification]
- Cheap-model per-URL sitemap triage (n8n #9296) — our deterministic rule engine (techaudit+~30 rules+med-spa pack) is MORE reliable and CHEAPER than gpt-4o-mini first-pass; we already deliver white-label reports. At most an optional Sheets/email export if a client asks. [verification]
- Funnel-scoped session-replay clustering agent (Amplitude) — needs rrww-style DOM-event capture we don't own and shouldn't; out of category for an SEO/AEO bot. Cheap transferable nugget only: feed Clarity rage/dead-click pages into cro.mjs as a priority signal (1-line). [verification]
- Listings publisher-API fan-out to GBP+Bing+Apple+aggregators (Synup) — requires paid partnerships/contracts (Data Axle/Foursquare); violates no-paid-API memory. Keep as worklist + a NAP-consistency DETECTOR (diff canonical NAP vs scraped live listings). Skip the publisher push + CRM review-request (no CRM in scope). [verification]
- Webflow reverse-proxy subdirectory trick (MPG/Webflow pSEO) — a no-code workaround for Webflow's CMS item cap; irrelevant to our Next.js/edge stack ([slug]+ISR = unlimited pages on one domain). Only nugget: serve any externally-hosted generated pages under main domain via path rewrite (a Vercel config line, not a project). [verification]
- DataForSEO / Ahrefs / SerpApi paid data APIs as primary sources — moot under no-paid-API memory; stealth-first is our differentiator. Treat any as optional opt-in corroboration only. Adopt the ENABLED_MODULES whitelist PRIMITIVE (cheap, real) but not the vendor dependency.
- seo-mcp Ahrefs ToS-bypass — skip the ToS-violating Ahrefs extraction; the only steal is the response-cache-keyed-by-query layer in front of our SANCTIONED stealth Maps path.
- Schemar GitHub Action vendoring — tiny/low-star wrapper around the schema.org validator; we already have schema.mjs + exit-code gating. Copy only the "run-on-deployed-URL-list in CI" ergonomic. [verification]
- Hi Cyou "smart auto-categorization" — overstated (28 stars, categorization is actually MANUAL in its admin); don't vendor. Fold the single-listing fetch→LLM→{title,meta,category} into the enrichment pipeline instead. [verification]
- Health Score rebuild — already have it (report.mjs/portfolio.mjs); only align scoring to funnel stages, don't rebuild. [verification]
