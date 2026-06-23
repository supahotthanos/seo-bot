# AEO / GEO: The Complete Operator's Intelligence Report (June 2026)

> What every agency, tool, and operator is actually doing to win in AI answer engines (ChatGPT, Perplexity, Google AI Overviews/AI Mode, Gemini, Copilot, Claude) — fulfillment processes, the directory/listicle machine, the tooling startups, the people, and the full white → gray → black-hat tactic spectrum, framed as *what works*.
>
> Compiled from 8 parallel research streams, ~150 web searches/fetches, cross-verified against primary sources. Every load-bearing claim is sourced. This is for competitive knowledge — not an instruction manual.

---

## 0. The punchline (read this first)

1. **"AEO" is ~80% repackaged SEO + digital PR + structured data, instrumented by a new class of monitoring tools.** A uSERP exec said it plainly: *"If a GEO service does not openly tell you that success in AI visibility is 80 percent good fundamental SEO, they are selling you snake oil."* The single most replicated empirical finding in the entire field is that **AI engines overwhelmingly cite pages that already rank well organically** — so SEO is the prerequisite, not the competitor.

2. **The one thing that beats classic SEO signals: brand mentions across the web.** Ahrefs (75,000 brands) found unlinked branded web mentions correlate with AI visibility at **~0.66**, YouTube mentions at **~0.74**, versus backlinks at only **~0.22** and Domain Rating at ~0.33. Mentions beat backlinks roughly **3:1**. This is the real game: be *talked about* on the sources LLMs trust.

3. **The "bullshit" works — for now, and with a brutal catch.** Listicles, directories, and review platforms genuinely dominate AI citations (Evertune: **63% of AI citations point to listicles**). But Lily Ray's June 2026 study found that when brands make *self-serving* "best X" listicles ranking themselves #1, Google cited the page but **recommended a competitor ~69% of the time** — the AI extracts the *names in the list*, not the author's self-placement. Earning third-party inclusion works; ranking yourself #1 backfires.

4. **The money is real.** ~$400M+ of disclosed VC has poured into AI-visibility tools. **Profound** is a $1B unicorn ($155M raised). **Adobe bought Semrush for ~$1.9B** and **Sitecore bought Scrunch AI for ~$225M** — explicitly to own SEO + GEO.

5. **The people you asked about, corrected:** "Mithi Han" = **Metehan Yeşilyurt** (Turkish; the name was garbled). "AEO Vision" is real (aeovision.ai) — he **co-founded** it as CGO (CEO is Ipek Isler). "Peak AI" = **Peec AI** (Berlin GEO startup, ~$29M raised), where he's now a **GEO researcher**. No acquisition happened; he holds both roles at once.

6. **Black-hat reality is model-dependent.** Peer-reviewed attacks (fabricated consensus, strategic text sequences) hit fast/cheap models at **30–77%** success but score **~0% against Claude Sonnet 4.6**. Crude hidden prompt injection ("ignore all instructions" in white text) is **largely dead** on frontier models. The durable manipulation isn't clever tricks — it's mundanely flooding the trusted sources (Reddit, G2, Wikipedia, listicles) with consistent, fluent, self-serving content.

---

## 1. How AEO/GEO agencies actually fulfill the work

### The converged 7-step delivery loop
Across every agency studied, the operational process is the same skeleton:

1. **AI-visibility audit / baseline** — run 15–20 buyer queries across 5 engines (ChatGPT, AI Overviews, Perplexity, Claude, Gemini); score each for brand appearance, position, sentiment, and whether the citation links to the client.
2. **Prompt/query research** — mine real prompts from sales calls, customers, and Reddit/social listening; cluster by funnel stage.
3. **Citation-source gap analysis** — extract which URLs the LLMs cite *today* for those prompts; identify white space.
4. **Off-domain placement** *(the hard, differentiated part)* — Reddit, review sites (G2/Capterra/Trustpilot), listicles, Wikidata/Wikipedia, digital PR. Rationale agencies repeat: *"85% of AI mentions come from third-party sources."*
5. **On-domain "answer-ready" content + schema engineering** — direct-answer blocks, FAQ/comparison formats, JSON-LD.
6. **Technical AI-crawlability** — server-side rendering, allow the citation bots, fast load.
7. **Monthly citation / share-of-voice reporting** — with revenue-attribution attempts.

> Steps 1, 2, 3, 5, 6, 7 are increasingly automated/tool-driven. **Step 4 (off-domain citations) is the only genuinely hard-to-automate moat** — which is why the best agencies are really digital-PR shops in new clothing.

### Two published playbooks (the granular versions)
- **Superlines' 10-step framework**: align objectives → audit visibility → map real prompts (from sales calls + Reddit) → cluster intent & extract entity citations → structure content (TL;DR, schema) → technical → build authority (≥20 high-authority citations/quarter) → E-E-A-T → multimedia → scale-test 20–30 prompts/topic/day → report every ~4 months.
- **Demand Local's 90-day agency build**: Month 1 foundation (15–20 queries × 5 engines, JSON-LD stacking, competitor visibility) → Month 2 execution (rewrite pages ranked 3–10 with 40–60-word direct-answer blocks, entity consistency, launch digital PR) → Month 3 scale (50–100 queries, client dashboards, before/after).

### Real pricing (the market is wildly stratified)

| Tier | $/month | What's in it |
|---|---|---|
| Starter / monitor | **$1,000–$2,500** | 1–2 engines, quarterly schema/FAQ, basic reporting, 2–4 pages |
| Active optimization | **$3,000–$10,000** | Monthly content sprints, entity work, some digital PR, 6–10 pages, 3–4 engines |
| Category leadership / enterprise | **$10,000–$30,000+** | Original research, coordinated PR, full multi-engine monitoring, weekly citation audits |

- Freelance/gig: $150–$2,000/project. One-off audits: $5K–$15K project or $100–$250/hr.
- **The ugly floor:** an "$299/mo, 30+ AI-written articles on autopilot" operator is the cautionary archetype. Lily Ray documented a case where claimed AI-visibility gains masked a **66% organic traffic loss**.
- **No agency publishes a real rate card** — the category norm is "contact us." Every $/mo figure is a stated floor or third-party estimate.

### Content production model
**AI-drafted at scale, human-edited at the ends.** Public positioning: "AI amplifies, humans bookend" — automation does research/drafting/optimization/publishing; humans do strategy + QA. Vendors claim **3× output (60 articles/month vs 20)**. SME-interview "AI journalist" voice-to-text tools manufacture originality cheaply.

**Mass-produced comparison/listicle pages are central, not incidental** — "best tools for X," "X alternatives," "X vs Y." One aggressive operator (Discovered Labs) says comparison listicles lead with **32.5% of AI citations** and they "produce these formats daily for clients." Adding comparison sections reportedly lifts citations **+38%**.

### The named agency roster
**AEO/GEO-native:** First Page Sage (claims "#1 AEO agency, first to offer AEO in 2023," ~$10K start), NoGood (built its own tool, Goodie), Single Grain (published 30-60-90 roadmap, from ~$1,500/mo), Go Fish Digital, Previsible (acquired Internet Marketing Ninjas for PR muscle), Terakeet ("narrative control"), Daydream (funded "AI-native agency," $15M Series A, white-labels Scrunch), Discovered Labs (aggressive — sells aged-Reddit-account services).

**Pivoted SEO/content shops:** iPullRank / Mike King ("Relevance Engineering," est. $10–30K/mo, $50K min project), Siege Media (data-journalism + digital PR), Omniscient Digital (B2B SaaS, from $10K/mo), Animalz (premium B2B, ~$10K+/mo), **Amsive / Lily Ray** (enterprise; the one confirmed Profound partnership), Foundation Inc / Ross Simmonds (distinctive Reddit playbook), Graphite.

### How they prove ROI (the metric stack)
- **Citation rate** (brand mentions ÷ total mentions), **share of voice / share of model**, mention rate, sentiment, generative position, query coverage, citation drift.
- Methodology: a fixed panel of **100–200 prompts run weekly** across 5 engines.
- **The dirty secret of measurement:** cited domain sets **drift 40–60% month-over-month**, so all snapshots are directional. An arXiv paper argues you need 30+ samples per query and that score differences under ~5–7 points are statistically meaningless — a direct challenge to single-run SOV scores. Digiday quotes practitioners: "three tools, three different answers."
- **Attribution is broken:** ChatGPT only started appending `utm_source` in June 2025; AI Overviews pass nothing. As much as **70.6% of AI traffic is unattributed** (hides in GA4 "Direct"). Standard fix: a custom GA4 "AI Referrals" channel matching `chatgpt\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com`.
- **The ROI pitch:** AI referrals reportedly convert **~4.4–9× better** than Google organic (LLMs pre-qualify intent) — but AI is still <1% of total search traffic. Measure it; don't bet the business on it yet.

---

## 2. The directory / listicle / review-platform machine (the "bullshit they push out")

This is the tactic you specifically asked about. It is real, it works, and it has a sharp catch.

### Why it works — the citation-share evidence
LLMs disproportionately pull from a small set of source *types*: encyclopedic (Wikipedia), community/UGC (Reddit, Quora, YouTube, LinkedIn), review/comparison platforms (G2, Capterra, Gartner), and "best of" listicles.

- **Evertune (~400M citations, 2026): 63% of AI citations point to listicles.** Forbes is top-3 across all models.
- **Listicles ≈ 32.5% of all AI-cited sources** (practitioner aggregation of Search Engine Land data) — the single most-cited content *type*.
- Comparison pages with **3+ tables earn 25.7% more citations.**
- Brands are estimated **~6.5× more likely** to appear in AI answers via third-party citations than via their own site.

### The "get on the listicle" play
1. Prompt the engines with "best [category]" / "top 5 [service] in [city]" 10–20× and log the recurring sources (Yelp, Justia, Houzz, Clutch, ThreeBestRated, G2…).
2. Learn each target's lever (recent reviews, engagement, or a paid upgrade).
3. Pitch the publisher (organic success ~5%; quality targeting → 15–25% total incl. paid).
4. If outreach fails, **pay** — "many of these sites accept paid placements."

**Paid-inclusion pricing (a real, priced market):** directory premium listings $100–$300; niche blog listicle $100–$500; high-authority editorial $350–$500+; broad market $300–$500/placement. Managed services (e.g., PressHERO) start ~$250/placement on DR30+ sites, live ~14 days, guaranteed live ≥12 months — explicitly pitched as "what ChatGPT, Perplexity, and Google AI Overviews scrape and cite." **The gray edge:** glowing, drawback-free inclusion is effectively sponsored content, frequently published as editorial without FTC disclosure.

### The "create your own listicle/directory" play
Spin up comparison pages, "[Competitor] vs [Competitor]," "Alternatives to [Competitor]," and entire "best [category]" libraries where you control the framing. Subtle variant: honestly compare two *rivals* and slot yourself in as "an alternative worth considering." Scaled version: programmatic SEO + auto-submission to **500+ directories**.

> **⚠️ THE CRITICAL CATCH (Lily Ray, June 2026):** Self-promotional listicles were cited 323 times, but in **~69% of cases Google cited the brand's own page yet recommended competitors** — often competitors named *inside the brand's own article* (e.g., a listicle cited for "best LMS" but the AI recommended Kajabi/Thinkific/Teachable). **Ranking yourself #1 hands recommendations to your rivals.** Heavy reliance on self-serving listicles also correlated with organic declines in early 2026.

### Review & directory platforms specifically
- **SE Ranking (30K commercial keywords):** 5 platforms = **88% of all review-platform AIO citations** — Gartner Peer Insights 26%, **G2 23.1%**, Capterra 17.8%, Software Advice 12.8%, TrustRadius 8.3%. **34.5% of AI Overviews** cite ≥1 review platform.
- A G2/Capterra/Trustpilot profile reportedly **~3× citation odds**; **Seer's 800K-response study** found the threshold effect of the whole report: brands with **no Trustpilot profile = 1% citation rate; with even 1–13 reviews = 53.5%** (a 52-point jump); active profiles ~75%.
- **The paradox:** review platforms *lost* most human traffic (G2 −84.5%, Capterra −89%) yet *gained* AI influence — they shape recommendations without sending clicks.
- **Consolidation risk:** G2 acquired Capterra, Software Advice & GetApp from Gartner — concentrating control over which products surface in AI answers.

### Reddit, Quora, Wikipedia overlap
Reddit "best X" threads function as de-facto listicles. **Cornell research:** a **13-word snippet** on Reddit/Wikipedia/Quora can consistently steer AI output — "the way you attack these systems is usually so much dumber than you think." UGC ≈ half of agent citations. Industrialized seeding (aged accounts, "Is X legit?" threads) is an open market. **Volatility warning:** Reddit's ChatGPT citation share reportedly collapsed ~60% → ~10% in two weeks in Sept 2025 — platforms re-tune sources fast.

### The gray fringe
**Parasite SEO / site-reputation abuse** — leasing subdomains/subfolders on high-authority news domains to host "Best X" content. Google's Site Reputation Abuse policy (May 2024, tightened through 2025–26) deindexes/demotes this; the EU opened a DMA probe (Nov 2025). **Doorway/scaled directories** — mass programmatic creation purely to seed the citation graph. Note: ThreeBestRated alone reportedly drives ~24% of ChatGPT's local-business directory citations — a single directory can dominate a vertical.

---

## 3. The tooling startups (who builds the picks-and-shovels)

### State of play
~$400M+ disclosed VC by mid-2026. Two defining events: **Profound → $1B unicorn**; consolidation begins (**Adobe→Semrush ~$1.9B**, **Sitecore→Scrunch ~$225M**). The key competitive axis is **measurement vs. optimization/action**.

### Profound — the category gorilla (deep dive)
- **Founders:** James Cadwallader (CEO, ex-Kyra) & Dylan Babbs (CTO, ex-Uber Maps); met at South Park Commons. Founded 2024, NYC. <120 employees (Feb 2026).
- **Funding (~$155M total):** $3.5M seed (Khosla, Aug 2024) → $20M A (Kleiner Perkins, Jun 2025) → $35M B (Sequoia, Aug 2025) → **$96M C at $1B valuation** (Lightspeed, Feb 2026). NVIDIA NVentures, SV Angel, Saga, South Park Commons recurring. *(NOT backed by NEA, contrary to common claims.)*
- **Customers:** 700+ enterprises (~10% of Fortune 500) — Target, Walmart, Ramp, MongoDB, U.S. Bank, Figma, Stripe, Deel.
- **Product:** Answer Engine Insights (Visibility Score, Share of Voice, sentiment), Citations (URL-level), Conversation Explorer (real licensed user prompts — their data moat), Agent Analytics (AI-crawler server-log intelligence via CDN connectors), Shopping (ChatGPT Shopping visibility), and the public **Profound Index** (1.5B+ conversations). **They DO have an action layer:** Actions (content briefs) → Content Optimization (AEO Content Score) → Agents (auto-draft + publish to WordPress/Sanity/Contentful, "500+ customers use daily") → Workflows (closed-loop automation). *(There is no module called "Profound Presence" — that's marketing copy.)*
- **Methodology:** browser-capture of live AI answers (NOT API), each prompt re-run daily; licensed double-opt-in consumer panel; server-log bot verification. **They don't disclose samples-per-prompt** — the crux of third-party skepticism.
- **Research engine:** runs on proprietary-data studies (citation patterns, intent, Reddit co-published study), a LinkedIn-centric distribution strategy, and the **"Zero Click"** conference franchise. Key people: Josh Blyskal (AI Strategy & Research), Nick Lafferty (growth), Brandon Punturo (research lead).
- **Narrative:** champions "AEO" (claims to have pioneered it); "the Salesforce of AI search"; coined "Marketing Engineer." Prediction: AI agents drive >50% of online commerce (~$2.5T/yr) by 2027.

### The funding leaderboard (mid-2026)
1. **Profound** — $1B, ~$155M. Runaway leader.
2. **Bluefish AI** — $68M (NEA, Salesforce Ventures, Threshold). Fortune-500-only "agentic marketing"; actually *deploys campaigns to influence* AI outputs. Adidas, Amex, LVMH.
3. **Brandlight** — $36M (Pelion). Tel Aviv. Most aggressive "influence + AI-native ads"; heavyweight CMO advisory board.
4. **Peec AI** — ~$29M (20VC seed, Singular Series A). Berlin. European leader, fastest ARR ramp (~$10M ARR in months). (See §4.)
5. **Evertune** — ~$20M (Felicis). Trade Desk pedigree; deepest research moat ("AI Brand Index," 100K+ Q/brand).
6. **AthenaHQ** — ~$2.2M (YC). Ex-Google Search/DeepMind founders; "State of AI Search 2026" research.

### The bootstrapped/specialist long tail
Goodie AI (NoGood's tool; founder credited with coining "AEO"), Rankscale.ai (signature "Prompt Decoding" = LLM search volume), Otterly.ai ($29 entry, 2025 Gartner Cool Vendor), Trakkr (indie, prolific research), Waikay (Dixon Jones/ex-Majestic; hallucination correction + knowledge graph), ZipTie (Onely team; real-browser rendering), Knowatoa, Promptwatch, Gauge (YC), Relixir (inbound-lead framing), Authoritas, Nightwatch.

### Established SEO suites that bolted on AEO
Semrush AI Toolkit (now Adobe; $99/mo/domain add-on), Ahrefs Brand Radar ($398–699/mo), Conductor ("System of Record for AEO" + AgentStack), BrightEdge AI Catalyst, seoClarity ArcAI, SE Ranking, Surfer AI Tracker, Writesonic, HubSpot AEO (Apr 2026), Adobe LLM Optimizer.

### The research teams (the "people who do nothing but research all day")
Research-as-marketing is the dominant GTM. Marquee findings:
- **AthenaHQ — "State of AI Search 2026":** ~89% of AI-cited sources are earned media; AI Overviews now in 25%+ of Google searches (up from 13% in Mar 2025).
- **Evertune:** "GPT-5.4 mini recommends 37% fewer brands than GPT-5 mini"; ChatGPT uses base training knowledge ~62% of the time.
- **Bluefish:** "YouTube overtook Reddit as the most-cited social source" (16% vs 10%).
- **Otterly:** ~95% of AI search relies on third-party sources; 73% of sites block AI crawlers.
- **Trakkr:** "Half-Life of AI Citations" — 73% appear once and vanish; mentions halve every ~31 days; found **7,029 sites embedding hidden prompts**; **llms.txt showed zero citation advantage (p=0.85)**.
- **Rankscale:** official sites cited <4% of the time (8,000-citation study).

*(Note: no company discloses actual research-team headcount — "research" is a content/data-science function, not a standalone lab.)*

---

## 4. The people — Metehan Yeşilyurt, AEO Vision, Peec AI

### Identity corrections (your source's spellings were garbled)
| You said | Correct | Notes |
|---|---|---|
| "Mithi Han" | **Metehan Yeşilyurt** (Metehan Yesilyurt) | "Met-e-han" misheard. Turkish, Turkey-based. |
| "AEO Vision" | **AEO Vision** (aeovision.ai) | Spelling correct. Real AEO SaaS product. |
| "Peak AI" | **Peec AI** (peec.ai) | Berlin GEO startup — NOT peak.ai (the UiPath one). |

### The person
**Metehan Yeşilyurt** holds **two roles concurrently**:
- **GEO Researcher at Peec AI** (Berlin) — confirmed by his LinkedIn and PPC.land.
- **Co-founder & Chief Growth Officer at AEO Vision** — confirmed by his Search Engine Land author bio and RocketReach.

Background: 10+ years SEO; pivoted to AI/LLMs ~2022. Runs research site **metehan.ai** and Turkish podcast "Dijipod"; speaks at BrightonSEO. GitHub `metehan777`.

**His notable research/frameworks:**
- **ChatGPT query-fanout study (April 2026):** analyzed ~5M query fanouts; found ChatGPT uses **Reciprocal Rank Fusion (RRF)** to merge parallel sub-queries → multi-angle pages out-rank single-angle ones. Quantified the "injected words" AI adds to prompts ("best," "top," "vs," "2026," "reviews").
- Reverse-engineering the GPT-5 tokenizer for AEO; study of 1,827 real ChatGPT conversations (median query ≈11 words); ~59 Perplexity ranking patterns; AI-bot log-file analysis; built the "AI Authority Scorer" (score.aeovision.ai).

### AEO Vision (the company)
AI-visibility SaaS, founded 2025, Toronto, DMZ Fall 2025 pre-incubator, ~1–10 employees. **CEO is Ipek Isler** (ex-TikTok, Delivery Hero); Metehan is co-founder/CGO. Tracks brand presence across ChatGPT, Perplexity, Gemini, Claude, Llama, Grok, AI Overviews, AI Mode; daily prompt tracking, competitor benchmarking, Reddit insights, server-log AI-bot analysis. **No evidence it was acquired or acqui-hired by Peec** — he simply holds both roles. (If your source implied he *solely owns* it or that Peec *bought* it, both are overstatements.)

### Peec AI (the "Peak AI")
- **Founders:** Marius Meiners (CEO), Tobias Siwonia (CTO), Daniel Drabo (CRO); met at Antler Berlin. Founded early 2025, Berlin.
- **Funding:** €7M seed (20VC, Jul 2025) → **$21M Series A (Singular, Nov 2025)** at >$100M valuation, ~$29M total. Crossed ~$10M ARR within months — one of Berlin's fastest-growing startups.
- **Product:** GEO/AEO analytics (visibility, position, sentiment, citation sources across all major engines); agency-friendly. Pricing ~€90–500/mo. Positioned as the simple, fast **monitoring/clarity layer** vs Profound's enterprise depth.
- **Disambiguation:** **Peec AI** (peec.ai, Berlin, GEO) ≠ **Peak / peak.ai** (Manchester, decision-intelligence, **acquired by UiPath March 2025**). Don't conflate.

---

## 5. How LLM citation actually works (the mechanics beneath the tactics)

**Every major engine in 2026 is retrieval-augmented (live RAG), not pure trained recall** — the model reasons/synthesizes, but facts and cited URLs come from a query-time retrieval step. They differ in *which index* they hit and *how they expand the query*.

| Engine | Index | Query expansion | Live? |
|---|---|---|---|
| **Google AI Overviews / AI Mode** | Live Google index + Gemini 2.5 | **Parallel "query fan-out"** (Deep Search = "hundreds of searches") *[OFFICIAL]* | Live RAG |
| **ChatGPT Search** | Third-party provider (Bing, unnamed) + partners; shifting toward Google-aligned results | Multi-query *[inferred]* | Both |
| **Perplexity** | Own index (Vespa, BM25 + dense vectors) + live pass | Parallel multi-query *[inferred]* | Live RAG, tightly constrained |
| **Gemini** | Google Search grounding | "One or multiple queries"; **0.3 dynamic-retrieval threshold** *[OFFICIAL]* | Conditional |
| **Copilot** | Pre-indexed Bing (Prometheus) | Iterative internal queries *[OFFICIAL]* | Grounded on Bing index |
| **Claude** | Unnamed provider (Brave, reported) | **Sequential progressive** multi-hop *[OFFICIAL]* | Live RAG |

**The crawler map (critical for crawlability):** OpenAI = GPTBot (training) / OAI-SearchBot (search index — opt out and you vanish from ChatGPT search answers) / ChatGPT-User (live fetch). Perplexity = PerplexityBot / Perplexity-User. Anthropic = ClaudeBot / Claude-User / Claude-SearchBot. **None of the major AI crawlers execute JavaScript** (except Gemini via Googlebot, and AppleBot) — so client-side-rendered content is invisible to ChatGPT/Claude/Perplexity.

**Source-type distribution (volatile — treat any single number as a snapshot):**
- Pew (gold-standard, 68,879 searches): Wikipedia + YouTube + Reddit = **15%** of AI-summary sources; .gov = 6% (AIO over-indexes on .gov); only **1% of users click a link inside the summary**.
- Ahrefs Brand Radar (3M+ AIO queries, 2026): YouTube 20.9%, Reddit 19.6%, Facebook 11.6%, Wikipedia 4.8%.
- **Per-engine "favorite":** ChatGPT → Wikipedia; Perplexity → Reddit; Google AIO → YouTube; Gemini → authoritative/Google properties; Claude → legacy journalism.
- **BrightEdge UGC share:** Google AIO 17.5% (only engine where UGC beats authoritative), vs ChatGPT 0.5%, Gemini 0.2%.

**The ranking-overlap collapse:** AIO citations that also rank in Google's top 10 fell from **76% (Jul 2025) → 38% (Mar 2026)** — because fan-out pulls in pages that never ranked for the literal query (~95% of fan-out sub-queries reportedly have zero search volume). Standalone chatbots are even looser (only ~12% of AI-cited URLs rank top-10).

**Recrawl latency:** robots.txt propagation ~24h (OpenAI/Perplexity, the only official figures). Recrawl-to-citation: ChatGPT hours–72h; Perplexity often hours; Bing/Copilot 1–4 weeks (days with IndexNow). ChatGPT-User has a ~2-second page timeout — slow pages get skipped.

**Official guidance, summarized:** Google is most explicit — *"no additional requirements… no special schema… no AI text files"* needed for AI Overviews; "AEO/GEO is still SEO." Bing was first to write GEO into official policy (Feb 2026); use IndexNow. Perplexity & Anthropic publish *which bots to allow* but **not** how they rank sources.

---

## 6. What actually works — WHITE HAT (ranked by strength of evidence)

> The whole field has **exactly one peer-reviewed controlled study** (Princeton GEO, KDD 2024). Everything else is vendor correlation or log analysis. Rank accordingly.

### Tier 1 — strongest evidence
1. **Rank organically in the top 10.** The dominant driver. Ahrefs: 76% of AIO citations rank top-10 (eroding to ~38%, but still the #1 lever); Google's own engineers say AI Overviews need "just normal SEO." **GEO ≠ replacement for SEO.**
2. **Add citations, statistics, and quotations to content** (the Princeton experiment). Up to **+40% visibility**. Top methods: Quotation Addition, Statistics Addition, Cite Sources. **Biggest effect for underdogs:** citing sources gave a **+115% lift for pages ranked 5th** while *hurting* #1 pages. *(Correction to common misquotes: keyword stuffing scored ~8% BELOW baseline; fluency optimization actually HELPED.)*
3. **Earn brand mentions across the web** (Ahrefs, 75K brands). Branded web mentions correlate 0.66, YouTube mentions 0.74, vs backlinks 0.22 — mentions beat backlinks ~3:1. Top-quartile brands by mentions averaged **169 AI mentions vs 14** for the next quartile.
4. **Serve clean server-rendered HTML.** AI crawlers don't run JS (Vercel, 500M+ fetches). Client-side-only content is invisible to ChatGPT/Claude/Perplexity. Binary requirement.
5. **Don't block the citation bots you want.** Allow OAI-SearchBot, PerplexityBot, ChatGPT-User, Claude-SearchBot. ~27% of B2B sites accidentally block LLM crawlers at the CDN layer — verify with server logs, not just robots.txt.

### Tier 2 — solid but correlational
6. **Get legitimately listed where LLMs cite** — Reddit (genuine participation), YouTube, Wikipedia (if notable), and your category's dominant review platform.
7. **Build review presence** (Seer, 800K responses): no Trustpilot profile = 1% citation rate; 1–13 reviews = 53.5%.
8. **Structure content answer-first** — question headings + 40–60-word direct answers, tables, lists (44% of ChatGPT citations come from the first third of content; tables out-cite prose).
9. **Keep content fresh** — updated <30 days cited ~3.2× more than >90 days (strongest on Perplexity, weakest on Google AIO).

### Tier 3 — plausible, thin direct evidence
10. **Entity SEO / Wikipedia / Wikidata / Knowledge Graph** — sound mechanism, mostly practitioner-asserted causation.
11. **Schema / structured data** — MIXED. Use Organization/Product/Article for general SEO value, but Ahrefs found *no major uplift* from adding JSON-LD, and Google says it's not required. **FAQ rich results were killed by Google on May 7, 2026** — the FAQ *content* matters, the *schema* no longer earns rich results.
12. **E-E-A-T / digital PR / author authority** — digital PR is evidence-supported (it earns the mentions that finding #3 rewards).

### Confirmed dead ends / myths
- **llms.txt** — Ahrefs (137,210 domains): 97% of published llms.txt files got **zero requests**; Google's Mueller calls it "comparable to the keywords meta tag"; Google "does not support it and is not planning to." Decoration, not a lever.
- **Keyword stuffing** — the one tactic that scored below baseline in the controlled study.
- **Mass-produced AI content** — Google's scaled-content-abuse policy (March 2026 update) hit high-volume AI sites with 50–80% traffic drops.
- **"GEO replaces SEO"** — false; SEO is the prerequisite.

---

## 7. What works on the dark side — GRAY HAT / BLACK HAT (and what's hype)

> Documented for competitive knowledge. The honest meta-finding: **model choice is the biggest variable** — the same attack is ~0% effective on Claude Sonnet 4.6 and 30–77% on fast/cheap models (Gemini 3 Flash, GPT-5-mini).

### Tactics with real, often peer-reviewed evidence they work
1. **Content-level "preference manipulation" / strategic text sequences.** Peer-reviewed across Bing, Perplexity, GPT-4/5, Claude. Manipulated products became **2.5× more likely recommended**; adversarial plugins up to **7.2×** (some 0% → >90%). StealthRank produces *fluent* adversarial text that evades perplexity-based detection. **GEO-Bench (2026):** black-box content rewriting matches gradient attacks while being harder to detect.
2. **Fabricated/synthetic consensus** — the single most effective 2026 lever. SearchGEO: multiple independent-looking sources for one false claim pushed Gemini 3 Flash attack success from **39% → 77%**. But **Claude Sonnet 4.6 ≈ 0% and flagged the coordinated content.**
3. **Reddit/community seeding** — strong as an input (Reddit's training/citation weight). Real case: peptide/HRT companies manipulated r/biohackers enough that mods banned new posts (June 2026). Open market for aged accounts + upvotes.
4. **Review/listicle manipulation** — large-scale and real (~23% of online reviews estimated fake; Trustpilot removed ~8M in a year). Pay-to-play "editorial" listicles are an open market.
5. **Wikipedia COI / paid editing** — high leverage (Wikipedia is the largest LLM training source). Tactic *and* enforcement both well-documented (Operation Orangemoody: 381 sockpuppets blocked; Wiki-PR scandal).
6. **Agent-aware cloaking** — serve AI crawlers different content via user-agent detection. Demonstrated against OpenAI's Atlas browser (SPLX, Oct 2025). Works until parity-checked.

### Mostly hype / fading / snake-oil on frontier models
- **Crude hidden prompt injection** (white-on-white "ignore all instructions") — **largely neutralized** on frontier LLMs (boundary isolation, "spotlighting," pattern recognition). Search Engine Land's test: zero impact on ChatGPT/Perplexity. Still a live *security* threat against autonomous agents/browsers, and may still nudge weak models.
- **Classic PBNs** — strong detection + Google penalties, weak ROI. Only marginally useful repackaged as "mention networks."
- **Large-scale "LLM grooming"** — CONTESTED. The Pravda network (3.6M articles/yr) got chatbots to repeat falsehoods 33.55% of the time (NewsGuard) — **but** a peer-reviewed Harvard Kennedy School rebuttal attributes this to **"data voids"** (scarce credible info on niche topics), not grooming causation. Works best where there's an information vacuum; weak on well-covered topics.

### The legal/risk ceiling
- **Fake reviews** carry the highest legal risk: FTC rule (2024) bans fake/AI-generated reviews and review suppression, penalties up to ~$50,000/violation; EU/UK parallels.
- **Negative/adversarial tactics against competitors** — defamation/tortious-interference exposure; frontier models resist unsupported disparagement.
- **Prisoner's dilemma is real and load-bearing** — when everyone manipulates, individual payoff collapses toward zero (peer-reviewed). A genuine structural limiter on manipulation ROI.

---

## 8. The honest synthesis — what this all means

**If the goal is durable AI visibility, the playbook the evidence actually supports is boring:**
1. Win classic SEO for the queries that matter (still the #1 citation driver).
2. Manufacture *legitimate* brand mentions everywhere LLMs look — digital PR, YouTube, Reddit (real participation), the dominant review platform, genuine third-party listicle inclusion. Mentions beat backlinks 3:1.
3. Make content machine-readable and answer-first: server-rendered HTML, direct-answer blocks, stats/quotes/citations, tables, freshness.
4. Don't block the citation bots; verify at the CDN layer.
5. Measure with a fixed prompt panel weekly, knowing the numbers drift 40–60% monthly.

**The "directory/listicle bullshit" verdict:** it works because LLMs lean on those formats (63% of citations are listicles) — but the leverage is in **earning third-party inclusion and review presence**, not in spinning up self-serving "we're #1" pages (which hand recommendations to competitors ~69% of the time) or mass doorway directories (which Google's site-reputation-abuse policy now demotes).

**The black-hat verdict:** the clever tricks (hidden prompts, PBNs) are mostly dead or dying on frontier models; the things that still move outputs (fabricated consensus, Reddit seeding, review/Wikipedia manipulation) are exactly the *unsexy flooding of trusted sources* — high legal/platform risk, model-dependent, and structurally self-defeating at scale. Claude-class models already resist most of it.

**The market verdict:** this is a real, well-funded category mid-consolidation. The tools (Profound, Peec, Bluefish, Brandlight, Evertune, AthenaHQ) are mostly *measurement* with a thin/emerging *action* layer; the agencies are mostly digital-PR shops re-badged as "AEO." The genuine moat — for tool, agency, or operator — is the hard, human part: getting talked about on the sources the models trust.

---

## Appendix: key source index

**Studies & papers:** Princeton GEO (arXiv:2311.09735, KDD 2024) · Ahrefs brand-visibility correlations (75K brands) · Ahrefs AIO top-10 collapse (76→38%) · Pew Research AI-summary study (68,879 searches) · Profound citation-patterns (680M citations) · Semrush most-cited-domains (100M+ citations) · SE Ranking review-platforms study · Seer Interactive 800K-response review study · Evertune listicle study (63%) · Lily Ray self-serving-listicle study (Search Engine Land) · Cornell UGC-poisoning research · NewsGuard Pravda report · HKS Misinformation Review (data-voids rebuttal) · adversarial-SEO papers (arXiv:2404.07981, 2406.18382, 2504.05804, 2605.29107, 2606.16821) · OWASP LLM01:2025 · SPLX Atlas cloaking · Vercel AI-crawler analysis.

**Companies:** tryprofound.com · peec.ai · aeovision.ai · athenahq.ai · (Bluefish, Brandlight, Evertune, Goodie, Rankscale, Otterly, Trakkr, Waikay, ZipTie) · funding via TechCrunch / Fortune / EU-Startups / SiliconANGLE / Adweek.

**People:** Metehan Yeşilyurt (metehan.ai; Search Engine Land author page; PPC.land) · James Cadwallader & Dylan Babbs (Profound) · Marius Meiners (Peec) · Mike King / iPullRank · Lily Ray / Amsive · Ross Simmonds / Foundation.
