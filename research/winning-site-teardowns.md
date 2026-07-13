# Winning Med-Spa Site Teardowns (June 2026)

> Reverse-engineered architecture of the best-ranking med-spa / aesthetic sites: page types,
> exact section orders, URL schemas, schema-graph, internal linking, technical stack — with real
> example URLs and copyable patterns. This is the "show me what actually ranks" companion to
> `medspa-seo-framework.md` (the checkable rules) and `aeo-deep-research-2026.md` (the strategy).
>
> **Ground-truth lens applied throughout** (do not violate when copying):
> - AI crawlers (GPTBot / ClaudeBot / PerplexityBot / OAI-SearchBot) **do not run JS** → every
>   load-bearing element (pricing, FAQ, NAP, before/after, schema) must be in the **server-rendered
>   raw HTML**. If `view-source` with JS off loses it, it's invisible to AI.
> - For local/healthcare, **listings carry the majority of AI citations** (Yext: ~86%
>   brand-controlled; healthcare ~52.6% sourced from listings). The site is necessary but the
>   GBP + citation stack is where the citation share lives.
> - **Answer-first** in the first ~30% of the page. **Tables out-cite prose.** **Named medical
>   reviewer** on every YMYL page. **Freshness via real change**, not date-bumps.
> - **Schema is a comprehension/entity-verification aid, not a ranking multiplier.** When schema
>   contradicts GBP, Google discounts the schema.
> - **Self-#1 listicles backfire** (don't rank yourself first on your own comparison/"best" pages).
> - **Vendor multipliers are directional only** (the "+40% clicks", "2.5x AI citation", "520% more
>   calls" numbers are single-source agency stats — copy the *tactic*, not the *number*).
> - **FTC fake-review / atypical-before-after penalty = $53,088 per violation (2026).** Every
>   review and before/after pattern below assumes 100% authentic, consented, typical-results content.

---

## 0. The two-SERP reality (decides which teardown applies)

Every med-spa keyword falls into one of two SERP regimes. The winning page type is different for each:

| Query type | Example | AI Overview fires? | Who wins | Copyable asset |
|---|---|---|---|---|
| **Local / "near me" / "[treatment] [city]"** | `botox near me`, `med spa Miami` | **~0%** (Google reverted local healthcare to the pack by Dec 2025) | Google Map Pack (3-pack) + Yelp/RealSelf directory pages | GBP + reviews + per-location service pages |
| **Informational / cost / comparison / candidacy / recovery** | `how much does botox cost`, `botox vs dysport`, `is lip filler safe` | **93–100%** | RealSelf, Healthline, Byrdie, device-brand sites, MD-authored clinic blogs | answer-first content + tables + named MD reviewer + schema |

**Operator rule:** Booking-intent pages (service + location) are won by the **local-signal stack** (GBP, NAP, reviews) — content is support. Research-intent pages (cost/comparison/candidacy/recovery) are won by the **AEO stack** (answer-first, tables, schema, E-E-A-T). Do not conflate them; do not build a 3,500-word essay to win "botox near me" (it won't), and do not expect a thin location page to get cited in ChatGPT for "botox vs dysport".

**Head terms** (`botox`, `laser hair removal` bare) at the national level are a moat owned by RealSelf, Yelp, and AbbVie/Allergan brand sites. Independent clinics should **not** fight them organically — dominate the local pack and capture device-brand-local terms (`Botox Cosmetic [city]`) instead.

---

## 1. The canonical winning URL architectures

Three architectures recur among the winners. Pick by scale.

### 1a. Boutique / single-specialty (Peachy model — Shopify)
Flat, hyper-local, answer-first pricing. Best when you do **one or few things** and want neighborhood-level dominance.

```
/                                  homepage
/pages/locations                   location hub
/pages/[neighborhood]-botox        16 location pages (williamsburg-botox, noho-botox, brooklyn-heights-botox)
/pages/[treatment]                 treatment pages (masseter-botox, botox-wrinkle-relaxers)
/pages/our-offerings               pricing/offerings hub
/pages/faq /pages/reviews /pages/press /pages/shop
/blogs/fountain-of-proof/[slug]    editorial (medically reviewed)
/blogs/fountain-of-proof/tagged/[topic]   tag-cluster hub pages
```
Key win: `/pages/masseter-botox` ranks ~#4 for "masseter botox" (69,107/mo) — **single-service depth beats menu breadth.** Neighborhood pages (`williamsburg-botox`) target intent national chains can't efficiently serve.

### 1b. National chain / franchise — 5-tier programmatic (LaserAway & VIO models)
The deepest indexable matrix. Best for multi-location at scale.

**LaserAway (custom SSR):**
```
/                                                  homepage
/services/[treatment]/                             national service hub (topical authority)
/services/[treatment]/[body-area]/                 sub-page (laser-hair-removal/full-body/)
/services/[treatment]/[area]/before-after/         area-specific gallery
/locations/[state]/[city]/                         clinic hub ("Beyond a Med Spa")
/locations/[state]/[city]/[service]/               local service page (THE workhorse: ~1,700+ pages)
/faqs/[category]/[question-slug]/                  cost-guide FAQ ("2026 Pricing Guide")
/faqs/[treatment]/[treatment]-cost-in-[city]/      geo-modified cost FAQ
/articles/[category]/[slug]/                        blog (timestamped)
/care/precare-[treatment]/  /care/postcare-[treatment]/   pre/post-care cluster
/pricing/  /bundles/                               national price table + packages
/doctors/  /doctors/dr-[name]/                     E-E-A-T roster + profiles
```
Matrix math: 220+ locations × ~8 services = **1,700+ local service pages**. Each level is an independently indexable, unique-title-tag page.

**VIO (WordPress, deeper category nesting):**
```
/[location-slug]/[category]/[subcategory]/[treatment]/
  e.g. /paramus/injectables/wrinkle-relaxer/botox/
       /fort-lauderdale/skin-treatments/facials/hydrafacial/
       /austin/wellness/weight-metabolic-health/glp-1/
```
Four-pillar nav maps to how patients search by **outcome category before product name**: Injectables / Skin Treatments / Body Treatments / Wellness. The Wellness pillar is the GLP-1 capture lane.

### 1c. Authority / multi-provider derm group — intent-separated subfolders (SkinSpirit & Schweiger)
Best when a medical/derm wing lifts the cosmetic pages (authority halo).

**SkinSpirit (WordPress + Yoast, Zenoti booking):**
```
/treatments/[treatment]                     24 canonical hubs
/treatments/[treatment]-in-[city]           ~180 geo-modified spokes (botox-in-walnut-creek)
/treatments/[treatment]-[city]-[state]      alt geo format (botox-bellevue-wa)
/locations/[slug]                            ~80 location pages w/ NAP + provider bios
/blog/[slug]                                 ~400 articles
/skinspirit-experts → /[expert-slug]         ~400 provider profiles
```
~1,100 total indexed URLs from a template engine.

**Schweiger (WordPress + Rank Math, Zocdoc) — the intent-separation gold standard:**
```
/medical-dermatology/[condition]/            clinical (insurance)
/cosmetic-dermatology/[treatment]/           aesthetic pillar (the med-spa wing)
/cosmetic-dermatology/[treatment]/[sub]/     sub-treatment (laser-treatments/aviclear-laser-for-acne/)
/location/[state]/[city]/                     160+ pages, 3-tier (national → state → city)
/providers/[first]-[last]-[credential]/       70+ physicians
/skin-care-articles/[category]/[slug]/        430+ blog
/skin-care-articles/press-releases/[slug]/    PR-to-SEO pipeline (indexed award pages)
```
The `/cosmetic-dermatology/` subfolder is a **standalone aesthetic pillar** that inherits the derm group's E-E-A-T. This is why board-certified derm groups out-cite 19 of 25 pure aesthetic brands in AI (5WPR index): **authority beats scale in YMYL.**

---

## 2. The copyable page templates (exact section orders)

These are reconstructed from the winners and converge tightly. Copy the **order** — it is the answer-first structure AI crawlers and snippet logic reward.

### 2a. Service / treatment page (the universal workhorse)
**Title:** `[Treatment] in [City, ST] | [Brand]` (front-load treatment, <60 chars)
**H1:** `[Treatment] in [City, ST]` (one H1; match title)
**URL:** `/[treatment]-[city]-[state]/` or `/treatments/[treatment]-in-[city]`
**Word count:** 800 min; 1,200–1,500 in competitive metros (NYC/Miami/LA).

Section order (this is the SkinSpirit/VIO/Cardinal/Intrepy consensus):
1. **H1 + 40–80 word answer capsule** — direct answer (what it is, who performs it, price anchor) in the first 100 words. *This is the only passage many AI crawlers extract.* Example: "Botox in Dallas starts at $12/unit at [Practice]. Most patients need 20–40 units per area and see results in 3–5 days."
2. H2 **What is [Treatment]? / How it works** (name the exact device — "Cynosure Apogee Elite, Alexandrite 755nm + Nd:YAG 1064nm", not "medical-grade laser")
3. H2 **Are you a good candidate? / Is this for you?**
4. H2 **What to expect** (session count, duration, results timeline)
5. H2 **Benefits** (5–8 bullets)
6. H2 **Recovery / Downtime**
7. H2 **Before & After** (gallery, descriptive alt text, link to `/before-after/` sub-page)
8. H2 **[Treatment] Cost in [City]** — named range, never "call for pricing" (see §2c)
9. H2 **What our experts say** — named-provider quote with credential string
10. H2 **FAQ** (3–8 Q&A, FAQPage schema, question text = autocomplete/PAA phrasing)
11. H2 **Why choose [Brand]** (credentials, press logos, reviews)
12. CTA block (Book + phone, repeated 5–6× through page at natural breaks — VIO/Schweiger both do 7+ "Book" instances and it doesn't feel pushy)

VIO's strict 8-section variant (verbatim, identical across all 68 locations, only the H1 city swaps): *What is it? → Is This For You? → What to Expect → Benefits → Downtime → Research → FAQ (12 Q) → Google Reviews →* then three brand-anchor modules (clinical-standards link / about / membership CTA) that push PageRank up to a few authority pages.

### 2b. Geo-modified treatment page (programmatic local layer)
The near-zero-marginal-cost scaling move. Take the canonical template and change **only**: title tag, H1 (add city/state), and a regional pricing disclaimer (`*Prices Vary By Region`). Everything else stays templated.
- SkinSpirit canonical: `Medical-Grade BOTOX by Expert Injectors | SkinSpirit`
- SkinSpirit geo: `Award-Winning Botox Bellevue | SkinSpirit`, H1 `BOTOX in Bellevue, WA`
- **Caveat (do not skip):** thin city-swap-only pages accumulate as "Crawled – currently not indexed" and waste crawl budget. If >15% of pages show that status in GSC, the pages are too thin. Add 2–4 genuinely unique local sentences (directions, landmarks, parking, named local provider) + a 3–5 Q local FAQ to earn indexing (the Schweiger location-page differentiation that makes 160 near-duplicates not duplicate).

### 2c. Cost / pricing page (RealSelf & LaserAway model — the highest-converting AEO page)
**H1:** `How Much Does [Treatment] Cost? [City] Price Guide [Year]` (the year + "Now" signals freshness for a decaying-data query — RealSelf uses "How Much Does [Treatment] Cost Now?")
**Word count:** 3,500–4,000 (these are comprehensive).
1. Author byline (PA-C/MD) + "Updated [Month Year]"
2. **Aggregate price data widget FIRST, before prose** — "Average cost: $1,870 based on 123 patient reviews" (the review count is the trust qualifier). Answer-first in the first 100 words.
3. **Table 1 — Brand pricing** (4 rows: Botox / Dysport / Xeomin / Jeuveau, $/unit)
4. H2 What affects the cost (provider expertise, area, location, sessions)
5. **Table 2 — Geographic price comparison** (named cities: "Cheapest: Kansas City, MO. Most expensive: NYC") — *tables out-cite prose; named-city tables get quoted in AI Overviews*
6. **Table 3 — Treatment-area breakdown** (20–30 rows: Area | Units Required | Est. Cost)
7. H2 How many units do I need?
8. H2 Financing (Cherry / Alle / CareCredit / PatientFi)
9. CTA → local finder / book
**LaserAway's framing trick:** benchmark your price against published averages (ASPS $697/session, RealSelf $1,043) to make yours look accessible — adds *sourced data* that satisfies YMYL depth and gets cited.

### 2d. Comparison / "vs" page (Coastal/Davama/Revive model — near-zero-competition keywords)
"Dysport vs Botox" = 19,000/mo at ~KD 0. RealSelf covers these shallowly; chains can't produce them per-practice. **MD-authored clinic pages displace RealSelf here.**
**Word count:** 3,200–3,500.
1. **Key Takeaways** bullet block (5 points)
2. **Quick-comparison TABLE in the first 20%** — 4–5 rows × 3 cols (Feature | A | B): Onset, Duration, Diffusion pattern, Best-for area, Typical units, Avg cost
3. The science behind each
4. Core differences
5. Which is right for you (by treatment area)
6. **Real patient narratives** (3, consented)
7. Local dosing/climate considerations (e.g., "Texas climate")
8. Side effects & safety (cite FDA approval + NCBI/PubMed)
9. Cost comparison in [city]
10. Financing/loyalty
11. **FAQ (10–14 Q)** with FAQPage schema
12. Gender-segmented section ("Brotox" for men) — captures a distinct segment, extends depth
13. CTAs ×3 (mid, cost section, close)
**Do NOT** rank yourself #1 on your own "best med spa" listicle — self-#1 backfires. Comparison of *treatments* is fine; comparison of *providers* with yourself on top is the trap.

### 2e. Treatment education guide (LeVogue/Aedit model)
Question-format H2s throughout (mirrors PAA), 2,400–2,600 words, 11–13 H2 sections, 5-Q FAQ, author bio, internal links to 4 supporting guides. Each H2 is a real autocomplete question: "What is microneedling and how does it benefit your skin?", "Is this treatment right for your skin type?".

### 2f. Location / clinic hub page
**Title:** `Botox, Fillers & Facials in [City] | [Brand]`
**H1:** `Welcome to [Brand] Med Spa in [City]` or `A Welcoming [Neighborhood] Med Spa in [City]`
Section order (Schweiger/SkinSpirit consensus):
1. Hero + local intro (unique neighborhood sentence)
2. **Meet our [City] providers** — named, full credential string (DNP, FNP-BC, NP, PA-C, RN, CANS), specialty, years — linked to profile pages. *This is the #1 E-E-A-T differentiator vs generic spas that list only first names.*
3. Services offered at this location (linked to service sub-pages)
4. **NAP block in the visible body** (not just footer — makes it indexable as main content): address + suite, local phone (area-code-matched), hours table Mon–Sun, parking/directions, neighborhoods/subway lines
5. Office photos (descriptive alt text)
6. **Per-location Google Reviews module** with live star rating + review count ("4.9 from 327 reviews") — ties social proof to the exact location
7. Local FAQ (7 Q)
8. Membership/ClubVIO pricing (if applicable)
9. Nearby Studios cross-links (3 proximate sister locations — builds the intra-city link cluster)
10. CTA

### 2g. Before/after gallery (Etna's highest-confidence win)
**Do NOT use one gallery page.** Give every patient case its **own URL** with unique title, meta, H1, per-image ALT text, and a written case-description paragraph (treatment + area + concern). Plus area-specific galleries (`/services/laser-hair-removal/underarms/before-after/`) that target narrower, higher-intent queries single-location competitors can't replicate at scale. ImageObject schema, WebP, CDN, lazy-load, consented + typical-results only (FTC).

### 2h. Provider profile page (the E-E-A-T atom)
`/providers/[first]-[last]-[credential]/` — name, full credential string, board certs (FAAD/FACMS), fellowship, medical school (`alumniOf`), locations served, before/after, review count, Q&A answer count, `sameAs` → LinkedIn / ORCID / state board / ABD directory. LaserAway has a CMO profile (`/doctors/dr-will-kirby/`); SkinSpirit names a board-certified plastic-surgeon CMO; VIO names a dual-board CMO. **A named CMO page announced via PR Newswire = authoritative backlink + verifiable named reviewer for all YMYL content.**

### 2i. Pre/post-care cluster (LaserAway's underused channel)
`/care/precare-[treatment]/` + `/care/postcare-[treatment]/`. Captures navigational queries from already-booked patients, reduces support load, and reads as a trust signal internally linked from service pages. Structure as numbered/bulleted instructions (AI extracts lists); put the first-24-hours answer at the top.

---

## 3. The schema graph (comprehension aid, server-rendered, in raw `<head>`)

Nest these as static JSON-LD **before any script executes** (client-injected schema is invisible to GPTBot/ClaudeBot/PerplexityBot). 73% of 847 audited aesthetic sites had critical schema misconfig — validate with Google Rich Results Test, not just a plugin.

**Per page type:**
- **Homepage / location:** `MedicalClinic` or `MedicalBusiness` (NOT `DaySpa`/`HealthAndBeautyBusiness`/`BeautySalon` — those are non-medical and forfeit YMYL trust) + `Organization` + `WebSite` + `LocalBusiness` props (`postalAddress`, `geo`, `telephone`, `openingHoursSpecification`, `priceRange`, `hasMap`, `aggregateRating` only if real visible reviews)
- **Treatment page:** `MedicalProcedure` (`bodyLocation`, `howPerformed`, `procedureType`, `preparation`, `followup`, `relevantSpecialty`) + `Offer` (priceRange, only real prices) + `FAQPage` (mainEntity Q/A, **visible text must match schema text exactly**) + `MedicalWebPage`
- **`MedicalWebPage.reviewedBy`** → `Physician` entity = "arguably the most impactful schema property for YMYL pages." Also `author`, `lastReviewed` (ISO 8601), `about` (`MedicalCondition`)
- **Provider page:** `Physician` (`name`, `medicalSpecialty`, `alumniOf`, `medicalLicense`, `worksFor` @id, `sameAs`)
- **Blog:** `BlogPosting` (`mainEntity` = the central question, `author`, `reviewedBy`)
- Site-wide: `BreadcrumbList`; gallery: `ImageObject`; booking: `ReserveAction`/`potentialAction` (also enables Reserve-with-Google)

**Type hierarchy reminder:** `Thing → Organization → LocalBusiness → MedicalBusiness → MedicalClinic`. A med spa with a supervising physician = `MedicalClinic`/`MedicalBusiness`.

**Stable `@id` interlinking:** `WebSite → WebPage → MedicalClinic ← Physician → MedicalProcedure`. Use `sameAs` to Wikidata Q-numbers / MeSH IDs on named treatments (e.g. botulinum toxin type A) for AI knowledge-graph reconciliation.

**The hard rule:** when schema asserts a fact (hours, price, provider) not supported by on-page content **or contradicting GBP**, Google discards the schema entirely. Schema must mirror GBP character-for-character.

**Notable gaps in otherwise-strong sites (free competitive openings to copy past):** Peachy ships **no JSON-LD at all** on service/location/blog. SkinSpirit has **no FAQPage schema** despite a large FAQ page and **no MedicalWebPage `reviewedBy`** on treatment pages. VIO shows no visible schema despite Yoast installed. Schweiger's `reviewedBy` exists only on blog, not service pages. **Adding FAQPage + MedicalWebPage.reviewedBy to treatment pages out-positions all of them on the YMYL/AEO axis.**

---

## 4. Internal linking topology (hub-and-spoke, dense)

The winners run dense, action-anchored internal graphs (every page reaches every hub within ~2 clicks):

- **Per-treatment three-node cluster:** treatment guide ↔ cost page ↔ local finder, all cross-linked (RealSelf splits `/nonsurgical/botox` from `/nonsurgical/botox/cost` precisely so each targets its own intent).
- **Concern pillars** (RealSelf `/concerns/acne-scars`, `/concerns/wrinkles`) as topical hubs linking to all relevant treatments — capture "how to get rid of [concern]" and feed the spokes.
- **Blog → service:** every blog post links back to its corresponding treatment page (Peachy/Intrepy/SkinSpirit hub-and-spoke); 3–5 contextual links per 1,000 words, descriptive anchors ("professional Botox treatments in [City]"), never "click here".
- **Intra-city "Nearby Studios"** (Peachy): each location page links 3 proximate sister locations — builds local clusters, reduces pogo-stick if a location is full.
- **Brand-anchor modules** (VIO): every one of thousands of treatment pages links up to a few authority pages (clinical standards / about / membership) — concentrates PageRank.
- **Cluster interconnection target:** ~80% between related cluster pages; top-performing editorial (Byrdie) top-100 articles average 66 inbound internal links.
- **Build the facial-treatments cluster first** (~52% of med-spa service volume): pillar + individual treatments + comparisons + concern pages + cost pages.

---

## 5. Technical stack of the winners

- **Rendering (binary requirement):** WordPress (most common — Schweiger/SkinSpirit/VIO/Intrepy/NKP), Webflow (SSR by default, ~58% CWV pass), Shopify (Peachy), or Next.js/SSG (LaserAway, Skin Laundry, Revive — chains). **No client-only SPA wins** — GPTBot/ClaudeBot execute zero JS (confirmed across 500M+ GPTBot fetches). Test: `view-source` with JS off; if pricing/FAQ/NAP vanishes → add SSR/Prerender.io.
- **CWV:** TTFB <200ms, LCP <2.5s, mobile load <3s. WebP + lazy-load + GZIP + CDN. Before/after galleries are heavy — NKP uses NitroPack; equivalents: WP Rocket, Cloudflare.
- **robots.txt — the split decision:**
  - **RealSelf and LaserAway explicitly ALLOW all crawlers** including GPTBot/ClaudeBot/PerplexityBot (`Allow: /`). RealSelf grants GPTBot `Allow: /` deliberately for AI-citation share.
  - **VIO blocks every AI crawler** (`Disallow: /` for ClaudeBot/GPTBot/anthropic-ai/Claude-Web/CCBot/PerplexityBot/OAI-SearchBot) while allowing Googlebot/Bingbot/DuckDuckBot — a brand-protection choice that **costs AI citation share**. For a client who wants AI visibility, **allow the AI crawlers** (this is the recommended posture per ground truth — listings + AI citations are a growing share of healthcare discovery).
  - Block thin/filter pages from indexing (SkinSpirit blocks all 8 `/benefits/` filter slugs; RealSelf blocks `/search`, vote/create endpoints).
- **Sitemaps at scale:** sitemap index with per-content-type and per-location sub-sitemaps (VIO: 145 child sitemaps, 3 per location; Schweiger Rank Math: 12 sub-sitemaps; LaserAway `sitemap_index.xml`). Update location/provider sitemaps **daily** (Schweiger shows daily `lastmod`) — signals currency to crawlers and AI sources.
- **Booking integrations seen:** Zenoti (SkinSpirit, VIO), Zocdoc (Schweiger), Boulevard/Vagaro (general), ZocDoc on every Schweiger location page is a structured booking signal.
- **403/anti-bot note:** LaserAway, NKP, and VIO 403-block scraper fetches but keep Googlebot/Bingbot open — structure here was reconstructed from SERP snippets/cache. If you 403 your own teardown attempts, that's the site protecting content, not a ranking signal.

---

## 6. The E-E-A-T / YMYL infrastructure (what separates winners from invisible)

Only ~39% of US med spas publicly list credentials — this is the cheapest differentiation.

- **Named CMO / Medical Director page** with board certs, publications, society memberships, `sameAs`. LaserAway (Dr. Will Kirby, DO, FAOCD + 25 board-certified derms), SkinSpirit (Dr. Sachin Shridharani, ASAPS, 500+ pubs), VIO (Dr. Alan Durkin, dual-board plastic surgeon), Schweiger (70+ named physicians). **Announce via PR Newswire** → authoritative backlink + named reviewer entity.
- **"Medically reviewed by [Name], [Credential]" on every clinical page** — links to the provider profile. RealSelf format: "Medically reviewed by Cameron Chesnut, MD, FAAD, FACMS, Dermatologic Surgeon, Board Certified in Dermatology." An **NP credential works** (Peachy uses "Larisa Fridlyand, AGACNP-BC" on every blog post) — you do not need an MD for the reviewer line. Never "reviewed by our medical team" (unnamed = lower trust).
- **Two-role byline** (RealSelf/cost-page model): named beauty/health **writer** (with publication credits) + named **medical reviewer**.
- **"Not a med spa" framing** (LaserAway): explicitly state the clinical governance model — who performs, who supervises, board certs — within the first screen. "[Brand] is a national aesthetic dermatology clinic — not a med spa. Every treatment is backed by clinical science and delivered by licensed medical professionals." This is YMYL architecture, not just copy.
- **Faculty / education page** (SkinSpirit, VIO University) listing named trainers with external affiliations (Allergan/Galderma master trainer, Duke DNP) — an underused authority asset.
- **Visible external citations** (Peachy cites a 2019 JAMA trial + 2016 study in FAQ; Aquagold page links 3 peer-reviewed studies). One or two real citation links per clinical page substantiates claims for users and crawlers.
- **Third-party press logos above the fold** (SkinSpirit: Vogue/ELLE/NYT/Women's Health/USA Today on every treatment + location page; Peachy: 18 placements on a `/press` page). Earned placement in Allure/Byrdie/Healthline is the external-validation signal both Google and AI citation engines use — pitch via Qwoted/Featured/Source-of-Sources.
- **Award/recognition PR pages** indexed on-site (Schweiger `/skin-care-articles/press-releases/`, RealSelf "RealSelf 100") — converts PR events into permanent indexed authority pages with backlink potential.

---

## 7. Pricing transparency (the answer-first conversion + AEO lever)

Two valid postures among winners — pick per client positioning:

- **Transparent flat-rate (Peachy, LaserAway):** exact dollar in the H1/first paragraph. Peachy: "$425 wrinkle / $525 masseter / +$150 brand upcharge," displayed everywhere. LaserAway: `$99–$649/session` table + `/bundles/`. This directly answers the #1 commercial query ("botox cost") with branded authority, is inherently shareable/citation-friendly, and reduces bounce. **The category charges per-unit (anxiety-inducing); a flat fee is a natural PR hook.**
- **Suppressed pricing → consultation funnel (Schweiger, VIO, SkinSpirit):** H2 "How Much Does [Treatment] Cost?" answered only with "varies by [variables], determined at consultation," or a "Starting at $X*" anchor with "*Prices Vary By Region." Blocks price-comparison exits, pushes to booking/membership. SkinSpirit shows "Starting at $159*"; VIO shows no price on treatment pages and routes all pricing to the ClubVIO membership page.

**AEO note:** the transparent posture wins more AI citations (sourced factual data point). If the client won't publish exact numbers, publish **ranges** with factors and a geographic table — that still satisfies the cost query. "Call for pricing" alone loses the user and the citation.

---

## 8. Retention / conversion mechanics baked into the architecture (not pop-ups)

- **Tiered loyalty with a paid premium tier:** LaserAway LaserLove/Premiere Points (Insider free / Icon $249/yr), VIO ClubVIO ($99–$169/mo banked credits), SkinSpirit FAB ($50). Drives repeat organic + direct traffic, improves dwell metrics, turns occasional visitors into high-LTV. Referral programs (Talkable/$50-give-$50-get) surfaced in every footer = acquisition loop.
- **Quizzes as top-of-funnel + personalization:** VIO Aesthetic Wellness Quiz, Peachy AI 3D facial-mapping tool (patent-*pending* — verify before repeating "patented"). Captures intent before a specific-treatment search.
- **Membership models create repeat-visit signals** that improve dwell/relevance metrics (SkinSpirit's 35.27% bounce — lowest of chains studied — correlates with strong intent-match + retention mechanics).

---

## 9. The local-signal stack (wins the "near me" / local-pack SERP — content can't)

Map Pack captures ~42% of clicks on local queries; you cannot win it with website copy.
- **GBP primary category = "Medical Spa"** (not Day Spa/Beauty Salon) — cited as the single most influential local-pack factor, above proximity. Secondary: Skin Care Clinic, Laser Hair Removal Service, Medical Clinic. Treat GBP as a mini-site: fill every field, 750-char service descriptions, Q&A seeded with keywords, weekly Posts, 100+ photos with geotags.
- **Review velocity > total count:** 8–12 new/month; respond within 24–48h. 100 procedure-specific reviews (review text names the treatment) often out-ranks 400 generic ones. Solicit via SMS 24–48h post-appointment with a treatment-specific prompt ("How did your skin feel 48 hours after your Botox?") to generate extractable clinical detail AI systems parse. **Never buy/incentivize/fabricate — $53,088/violation.**
- **NAP character-for-character identical** across GBP + on-page schema + Yelp + Healthgrades + RealSelf + Zocdoc + Vitals + WebMD + AmSpa directory + manufacturer locators (CoolSculpting/HydraFacial/Emsculpt/Allergan). Even "Suite 200" vs "Ste 200" suppresses local pack; when schema ≠ GBP, schema is discounted. **Brand-mention correlation with AI citation (~0.664) is ~3× backlink correlation (~0.218)** — citation consistency feeds AI confidence, ambiguity sends the citation to a competitor.
- **Manufacturer provider locators** (register + maintain all applicable) appear in SERPs for device-brand searches and act as high-authority citations.

---

## 10. Aggregators you compete *with* and *around* (don't fight head-on)

- **RealSelf** (AS 64, ~2M visits/mo, allows GPTBot): 7 page types — treatment guide, **separate cost page** (`/nonsurgical/[t]/cost`), reviews aggregator, doctor Q&A (`/questions/[t]/[symptom]`), **programmatic local finder** (`/find/[State]/[City]/[Treatment]` — thousands of city×treatment pages), concern hub, doctor profile. Proprietary "Worth It %" appears in snippets. **Copy:** split guide from cost; concern hubs; programmatic local matrix; Worth-It-style proprietary trust metric; named two-role bylines; community Q&A on a **subdomain** (`community.realself.com`) to keep thin forum content off the main domain's E-E-A-T.
- **Healthline / Byrdie:** named writer + credentialed medical reviewer, 1,200–2,600 words, TOC, FDA citations, concern-based nav (Byrdie organizes by patient concern, not service name — that's how it ranks 1.1M+ keywords). **Don't out-rank them — become a cited source** via earned placement, and out-MD-author them on local + comparison terms.
- **Yelp** sweeps city-list organic for nearly every "[treatment] [city]"/"near me"/"med spa [city]". **Maintain the listing; don't try to organic-outrank the directory.**
- **Device-brand sites** own AI citation share: Botox 95, Juvederm 83, Dysport 78, Restylane 77, CoolSculpting/Sculptra ~69, RealSelf 86 (5WPR index — proprietary, directional). Top 25 brands ~95% of AI citations; AbbVie/Allergan ~47%. **Defensive move:** build a brand-specific local page (`/botox-cosmetic-[city]/`) mirroring manufacturer language + listing as authorized provider + linking the manufacturer locator.

---

## 11. Agency-claimed concrete patterns worth copying (sourced, hype-flagged)

The aesthetic-specialist agencies (Etna, Studio III, Cardinal, Intrepy, Sagapixel, NKP) converge on the same concrete tactics — these are the durable ones, stripped of the unverifiable headline numbers:

- **One page per treatment per location.** Universal. Title `[Treatment] Services in [City], [State]` (Intrepy) or `[Treatment] in [City]` (everyone). "If you want to rank for it, you need a page for it."
- **Cardinal's 8-step location page:** hub → individual pages (500–1,000+ unique words, nearby landmarks) → provider bios w/ photos → services linking to sub-pages → embedded map + click-to-call + inline scheduler → LocalBusiness + FAQPage schema → location keyword in slug + title + H1 → exact NAP (USPS-approved, unique suite + phone per location).
- **Intrepy:** treatment page 500-word min; blog 1,000–1,200 targeting long-tail; FAQ answers **45–80 words** each (snippet/AI-overview length); hub-and-spoke (blog → treatment page); semantic slugs (`/services/coolsculpting-atlanta`, never `/service-1`).
- **Studio III:** "brand clarity before optimization"; **query fan-out** content (one page answers the whole sub-query cluster — cost, qualifications, recovery, results, risks — not one narrow keyword); pre-build location pages before a clinic opens; 4-bucket email segmentation; report on **booked appointments/revenue, not pageviews** ("the Great Decoupling" — AI Overviews intercept TOF clicks, BOF intent still converts).
- **Sagapixel:** video-to-blog (60-min expert shoot → 2–6 clips → 2,000-word article w/ embedded video → repurpose to Reels/TikTok/Shorts); surrounding-municipality location pages (thinner competition); month-to-month, $75/hr (below the $100–150 avg).
- **Etna:** entity coherence — narrow the declared specialty and repeat it identically across homepage/about/every provider bio/GBP/social ("AI reads entity coherence across properties, not a single page"); individual before/after case pages (§2g); SILO-style schema expressing provider→location→procedure relationships.
- **Content discovery method (Cardinal):** pull Google Ads search-query reports to find patient vernacular ("lip filler" not "hyaluronic acid", "laser hair removal" not "IPL photoepilation") and use *that* phrasing in headers/copy.

**Agency hype to discount (do not repeat as fact):** OVME "1,217% bookings in 3 months" (no baseline, likely near-zero start), Genesis "1,204x traffic" (zero-baseline client), Etna "61% of national B&A mobile results"/"10:1 ROI", Studio III "302 markets #1", self-ranked "#1 med spa SEO agency" listicles, Sagapixel "30x traffic" (from ~6 visitors), and all "+40% clicks from schema" / "2.5–2.7x AI citation from FAQPage" / "520% more calls from 100+ photos" / "85.79% of AI Overview sources have structured data" — single-vendor, unaudited. Copy the tactic; never quote the multiplier to the client as a guarantee.

---

## 12. The copy-this checklist (operator quick-reference)

For a new Next.js client build, in priority order:
1. **SSR everything load-bearing** (pricing, FAQ, NAP, before/after, schema in raw `<head>`). Verify with JS-off view-source.
2. **GBP "Medical Spa" + exact NAP everywhere** + review-velocity workflow (treatment-specific prompts, authentic only).
3. **One service page per treatment per location**, `[treatment]-[city]-[state]` slug, the §2a template, 40–60-word answer capsule first.
4. **Named medical reviewer line on every clinical page** + a CMO/Medical-Director profile page (`sameAs` to externals).
5. **Schema stack:** MedicalClinic → Service/MedicalProcedure → Offer → FAQPage → MedicalWebPage(`reviewedBy`) + Physician. Validate in Rich Results Test; mirror GBP exactly.
6. **Separate cost pages** (§2c) with 3 tables + year in H1; **comparison pages** (§2d) with first-20% table. Tables, not prose.
7. **Individual before/after case pages** (§2g), consented, typical-results, ImageObject + WebP.
8. **Pre/post-care cluster** (§2i).
9. **Dense hub-and-spoke internal links** (blog→service, concern pillars, nearby-locations, 80% cluster interconnection).
10. **robots.txt allows GPTBot/ClaudeBot/PerplexityBot/OAI-SearchBot/Google-Extended**; sitemap index w/ per-location sub-sitemaps; daily lastmod on location/provider sitemaps.
11. **Press logos above fold** + earned-placement pitching; **indexed PR/award pages** on-site.
12. **90-day substantive content refresh** (real change + visible "reviewed [date] by [Name, Cred]"), not date-bumps.
