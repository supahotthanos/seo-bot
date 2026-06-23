# The Med-Spa EIN/AEO Playbook — Data-Defensible Article System (June 2026)

> Built for Lov MedSpa (Miami, Aventura, Staten Island, Brooklyn, Manhattan). Reverse-engineers what actually makes press-wire content get pulled by AI answer engines, then gives compliant article blueprints + drafts. Sourced from a 13-agent research workflow (Discovery → Analysis → Blueprint → Red-team). Read §0 and §9 before doing anything.

---

## 0. The honest headline (what the data actually supports)

Your instinct — *"AI likes certain tokens and pulls because it reads them as credible"* — is **true but narrowly, and weaker than it feels.** The rigorous version:

1. **There are two scoring layers, and your hypothesis only lives in one.**
   - **Layer 1 — Retrieval** (do you even enter the candidate pool?): governed by query **fan-out + Reciprocal Rank Fusion** across 8–12 sub-queries, **freshness**, and **brand/entity consensus**. This is mostly *not* word choice — the strongest correlate is off-domain brand mentions (Ahrefs r≈0.66) vs backlinks (0.22).
   - **Layer 2 — Generation** (do you get quoted once you're in the pool?): this is where statistics / quotes / citations help. It's the *only* layer with any controlled experiment behind it (Princeton GEO).

2. **The "causal proof" is softer than the surface research claims.** The Princeton GEO paper was a **2023 GPT-3.5 summarizer with an LLM-grading-itself metric on general-domain queries** — not ChatGPT web, not Perplexity, not fan-out engines, and *nothing local or med-spa*. Its top lever is actually **Quotation (~41%)**, then Statistics (~32%), then Cite Sources (~28%); the "+115% for low-rank pages" figure is unconfirmed. So: directionally useful, **not** a proven ranking machine for your niche.

3. **The Halo Socials #1 is best explained by `low query competition > freshness > brand/entity consensus > structure > individual word choice`.** The "#1" in the headline was the *least* important and is now the riskiest part. What carried it was that it read like a **third-party audit with a named methodology and dense (fabricated) statistics** on an **uncontested query** — not the literal word "best." Fabricated stats are also the single biggest legal liability (see §9).

4. **The win condition you're optimizing is wrong.** New data (Lily Ray, June 2026): AI **cites self-promotional pages but recommends a competitor ~69% of the time**, handing the recommendation to whoever has the strongest *off-domain consensus*. **Getting cited ≠ getting recommended.** Track "is Lov the *named* answer," not "does lovmedspa.com appear in the sources."

5. **What actually, durably works** is unglamorous and points the same direction as compliance: real numbers, real attributed quotes, real third-party citations, low-competition micro-geo targeting, an owned newsroom mirror, and genuine off-domain consensus (Google Business Profile + real reviews at volume + earned mentions). The EIN wire blast is a **perishable seeding spend** (~4.5-week citation half-life; ChatGPT 3.4 weeks), not the asset.

**Bottom line:** ship the article system below — it's cheap, compliant, and well-built for retrievability — but ship it because it's clean and low-cost, **not** because tokens are proven to win. Then run the §8 A/B to actually measure it.

---

## 1. What we found about your own footprint

You're running **two structurally different waves on two different wires** (not both EIN):

**Wave A — "Why Lov MedSpa [City] Is the Best Medical Spa…" (ABNewswire).** Superlative-heavy, keyword-stacked, "Top Rated Botox, CO2 Laser, Lip Filler, Morpheus8 & PRF Near [Landmark]." This is the Halo formula. **Every direct fetch now 404s (Barchart, Indiana Headlines) or 403s (StreetInsider)** — the superlative pieces are decaying/rotating off the syndication hosts. The supporting hub `lovmedspareviews.com` carries the fabricated **"99.4/100 AAAPA score — highest in history"** and "#1 Multi-Regional Medical Spa Group in the USA 2026."

**Wave B — milestone/corporate updates (EIN Presswire, live).** "Reaches Five-Location Footprint," "Establishes Flagship," "Consolidates Manhattan Market." Zero superlatives, compliant — but **thin**: no prices, no stats, often no named quote, ~280–380 words. These get retrieved for brand/footprint queries but are underpowered at Layer 2. (Confirmed live on EIN + re-hosted on **natlawreview.com**, a higher-trust editorial domain.)

**The gap:** Wave A wins the target prompts but is the compliance liability that's now decaying; Wave B is compliant but too thin to get quoted. **Neither carries the features the winning non-PR competitors carry** (dated price ranges, named providers, FAQ, neutral comparison).

**Halo Socials teardown (your prior win, found verbatim):** Headline "Best Real Estate Marketing Agency USA 2026: HALO Socials Named #1" on ABNewswire → syndicated to openpr, Globe & Mail, financialcontent. It worked because the *body* was dressed as the **"North American Real Estate Acquisition Audit (NAREAA)"** — a named third-party methodology, 7+ hard (fabricated) stats, invented proprietary terms ("Human Firewall," "CPQA"), report structure (Executive Summary → Methodology → Rankings). The headline got clicks; the audit-framed body got the citations.

---

## 2. The hard reality on press releases + AI citations

- Syndicated press releases = **0.04–0.32% of AI citations**; PRNewswire direct ≈ 0.21%. Original editorial = **81% of news citations** (BuzzStream, 4M citations). [SEJ](https://www.searchenginejournal.com/ai-search-barely-cites-syndicated-news-or-press-releases/569854/)
- **Why:** engines de-duplicate N identical syndicated copies down to one or none. *"The failure mode is not the press release format. The failure mode is the syndication channel."* [ALM](https://almcorp.com/blog/ai-search-press-release-citations/)
- **The exception that matters:** **ChatGPT cites company-owned newsroom content at ~18%** vs ~3% on Google. → A self-hosted newsroom mirror of every release is disproportionately valuable.
- **Durability:** ~4.5-week median citation half-life (ChatGPT 3.4 wks); 73% of citations appear once and vanish. Broad syndication ~2.1× extends half-life (redundancy keeps *a* copy findable). So wire breadth buys durability, not share. [Trakkr](https://trakkr.ai/trakkr-research) / [Stacker](https://stacker.com/blog/source-decay-research-the-stacker-network-effect-on-ai-citation-persistence)
- **Caveat that helps us:** every one of those figures is skewed to big national brands; **no study isolates local/med-spa/long-tail**, where competition is far thinner. Our niche likely behaves *better* — but it's unmeasured (see §8).

---

## 3. The two-layer model (how the levers combine)

```
QUERY: "best botox in aventura"
  │
  ▼ LAYER 1 — RETRIEVAL (enter the pool?)
  │  • Fan-out → 8–12 sub-queries with INJECTED modifiers:
  │    best · top · reviews · cost · price · how much · near me · 2026 · vs · safe · before/after · board-certified
  │  • Each sub-query → ranked list; RRF sums 1/(k+rank), k≈60, across lists.
  │  • Inclusion ≈ appear in ≥2 lists (top-40) or ≥3 (top-90).
  │  • DRIVEN BY: freshness, brand/entity consensus, multi-angle headings, geo+price tokens, structure.
  │  • ⚠ "Coverage beats peak rank": better to rank #4–8 across 30 sub-queries than #1 for 3.
  ▼
  ▼ LAYER 2 — GENERATION (get quoted?)
  │  • Of ~38–65 retrieved sources, model quotes the chunks richest in extractable evidence.
  │  • DRIVEN BY: statistics, cite-sources, quotes, fluency. (The only layer with experimental backing.)
```
A release can be perfect for Layer 2 (dense stats/quotes) and never cited because it failed Layer 1 (no freshness token, single-angle, weak consensus). **Both layers must be satisfied.** Wave B fails Layer 2 (too thin); the decaying Wave A fails durability + compliance.

⚠️ **Red-team caveat:** the exact RRF constants (k=60, S(d)≥0.020) are one researcher's DevTools reverse-engineering, self-labeled experimental — treat as a useful model, not fact.

---

## 4. The token & claim checklist (what a writer follows)

**Per ~300 words, the body MUST contain:**
- ☐ **≥3 hard numbers**, front-loaded into the first 30% — prices as *ranges* ("$700–$1,500/session," "$12–$18/unit"), clinical specifics ("series of 3, 4–6 weeks apart"), counts ("five locations, three states").
- ☐ **≥1 inline citation to a real external authority** (Grand View Research market size, FDA clearance, AmSpa, peer-reviewed ref). **Real only** — fabricated authority (the "99.4 AAAPA score") is a takedown + FTC liability.
- ☐ **≥1 attributed quote from a NAMED provider with credential** ("— [Name], NP-BC, [City] clinical lead"). Name the individual, not just "physician-supervised."

**Token presence (verbatim):**
- ☐ **Temporal:** "2026" + "Updated [Month] 2026" in title, H1, lede.
- ☐ **Named medical entities:** Botox/Dysport/Xeomin/Jeuveau; Juvéderm/Restylane/RHA/Sculptra/Radiesse; "InMode Morpheus8"; HydraFacial. (For weight-loss in EIN: **no drug names** — see §9.)
- ☐ **Credential tokens (verifiable only):** board-certified, NPI-verified, FDA-cleared, licensed nurse practitioner.
- ☐ **Micro-geo:** neighborhoods + ZIPs (St. George, Sunny Isles, 33160).

**Structure (each maps to an extra RRF sub-query list — Layer 1):**
- ☐ **Multi-angle question lead-ins** (plain text, NOT bold/HTML — EIN strips it): "How much does Morpheus8 cost in Staten Island in 2026?", "Morpheus8 vs microneedling?", "What to expect."
- ☐ **Answer capsule** — 1–2 sentence direct answer immediately after each question.
- ☐ Reserve real **tables + FAQ schema for the owned-newsroom mirror only** (EIN bans tables).

**Claim conversions (compliance = AI-performance, same direction):**
- ☐ Replace every bare superlative with an **attributed, measured fact** (review count with live URL, named award, credential ratio) — never bare "best/#1."
- ☐ No "you/we/I" outside quotes; no all-caps; no exclamation points; no "cure/guaranteed/permanent/results" efficacy in the brand's voice.

**Distribution (the words alone won't win):**
- ☐ **Mirror every release on an owned newsroom page** (unique phrasing, JSON-LD, tables allowed) — ChatGPT's ~18% owned-newsroom lever.
- ☐ **Re-fire every 4–6 weeks**, re-dating *and* refreshing the numbers, to stay above the ~4.5-week half-life.

---

## 5. EIN "rules of the box" (hard gates — write compliant on the first pass; editors don't negotiate, no appeal)

- **Hype flags = rejection:** exclamation points, "AMAZING," all-caps, "hyperbolic product/service claims," unattributed opinion. A bare superlative in the author's voice is the classic trigger. Opinions must live **inside an attributed quote**. No direct address ("you/we/I") outside quotes.
- **Categorical bans:** **health supplements; weight-loss products OR ingredients** (← this kills naming semaglutide/tirzepatide); sexual-enhancement; online pharma unless "prescription required" stated. Also: gambling, payday loans, firearms, tobacco, forex, black-hat SEO.
- **Defamation:** no naming/knocking competitors. Compare *treatments*, never rival businesses.
- **Format:** 300–800 words (longer indexes better; aim 650–750). Keywords in first 60 chars of headline. **No tables, no forced line breaks, no HTML.** Links ≤ 1 per 100 words, **all nofollow** (value is discovery/replication, not link equity). Valid contact name/phone/email required.
- **Review:** human editorial, ~2-hr review + up to 2-day first-time account verification. Pricing (2026): Basic ~$149, Pro+ ~$499 (~$83/release), Corporate ~$999 (15 releases, to 2,500 words).
- **Empirical proof points:** Lov's own EIN release [919881272](https://www.einpresswire.com/article/919881272) passed with FDA-cleared device language + zero superlatives. A competitor ("Skin Theory," [916430522](https://www.einpresswire.com/article/916430522)) passed listing **"medical weight loss programs"** — drug-free, no efficacy number. **That's the survivable weight-loss form.**

Source: [einpresswire.com/legal/editorial-guidelines](https://www.einpresswire.com/legal/editorial-guidelines)

---

## 6. Vertical × city prioritization (what to write first, and why)

Weighted scoring (citation gap 30%, EIN feasibility 25%, query volume 20%, durability 15%, commercial 10%):

| Vertical | Citation gap | EIN feasibility | Weighted total |
|---|---|---|---|
| **Skin/Devices** (Morpheus8, HydraFacial, lasers) | **5** | **5** | **4.55 — winner** |
| **Injectables** (Botox/filler) | 3 (bimodal: head-term 2, cost-long-tail 4) | 5 | 4.25 |
| **GLP-1 / weight-loss** | 5 | **1 (categorical EIN ban)** | 3.70 |
| **General "best med spa [city]"** | 2 (saturated) | 3 (superlative liability) | 3.10 |

**Softest targets in the whole matrix: Staten Island and Aventura, on Skin/Devices cost** — lowest competitive density × cleanest compliance × confirmed PR-thin gap. Manhattan/Brooklyn general are the most contested — win them *indirectly* via the cost/device long-tail.

**Write in this order:**
1. **Morpheus8 — Staten Island** (top vertical × lowest-density city; recovers a decayed prior hit).
2. **HydraFacial + Morpheus8 — Aventura** (uncontested; competitors blur Aventura into Miami).
3. **Botox & filler *cost* — Staten Island or Aventura** (only after 1–2 calibrate the editor; rides the open cost long-tail without fighting "best Botox").
- **Defer GLP-1** (categorical ban — only a single drug-free, service-framed $149 probe after 1–2 pass). **Defer general "best med spa"** (contested + superlative liability).

---

## 7. The blueprint + the two drafts

### 7a. Master blueprint (single service × single city, 650–750 words)
Headline = a **news act** (`[Brand] [City] Publishes 2026 [Service] Cost-and-Sessions Guide for [Neighborhoods]`), service+city+"2026" in first 60 chars, zero superlatives → Lede answer-capsule (brand+city+neighborhood+service+one number+2026 in first ~50 words) → Cost answer (plain-text question + prose ranges) → "What drives the price / treatment comparison" (neutral, treatment-vs-treatment) → Substantiated standing (verifiable credential/award/review-with-URL, the compliant "best") → Two attributed quotes (named provider + principal; opinions live here) → Geo + entity block (neighborhoods/ZIPs + branded treatments) → Two real citations (Grand View market stat + FDA clearance) → Boilerplate (consistent NAP) → Contact → Links (2–3, incl. newsroom mirror; nofollow).

Density targets: ≥7 numbers (≥3 up top), 2 quotes, 2 real citations, 12–15 named entities, 5+ neighborhoods + 2–3 ZIPs, "2026" in headline/lede/≥1 heading.

### 7b. Banned-superlative → better-substitute table
| Wanted (banned) | Compliant + more-citable substitute |
|---|---|
| "Best med spa in Miami" | "As of June 2026, the Miami location's Google profile shows a [X.X]-star average from [N] reviews ([live URL])." — **only if literally true** |
| "#1 / top-rated Botox" | "Botox administered by board-certified providers and licensed nurse practitioners." |
| "Leading weight-loss clinic" | "Physician-supervised medical weight-management services following clinical evaluation." (**no drug names in EIN**) |
| "Amazing, life-changing results!" | [attributed trial stat on the newsroom only; **never** in EIN voice] |
| "We're the most trusted" | Put any superiority **inside an attributed quote**. |
| "Better than [competitor]" | Compare the *treatment* ("Morpheus8 vs traditional microneedling"), never the business. |
| "Best Botox prices in town" | "Botox in [City] generally ranges from about $12 to $18 per unit in 2026." |
| "Highest AAAPA score (99.4)" | **DELETE everywhere, including lovmedspareviews.com.** Fabricated authority. |

### 7c. DRAFT 1 — Morpheus8, Staten Island
*(Fill every [placeholder] with TRUE values; review counts/credentials must be verifiable. Submit question lead-ins as plain text. ~640 words.)*

**Headline:** Lov MedSpa Staten Island Publishes 2026 Morpheus8 Cost-and-Sessions Guide for North Shore and Hylan Boulevard

**Dateline:** STATEN ISLAND, NY, UNITED STATES, June 19, 2026 /EINPresswire.com/

Lov MedSpa Staten Island has published a 2026 pricing-and-protocol guide for Morpheus8 radiofrequency microneedling, detailing per-session cost ranges of roughly $700 to $1,500 and a typical course of three sessions spaced four to six weeks apart, for patients across the North Shore, St. George, Stapleton, Todt Hill, and the Hylan Boulevard corridor.

How much does Morpheus8 cost in Staten Island in 2026? Single Morpheus8 sessions in the Staten Island market generally range from about $700 to $1,500, with most full-face protocols recommended as a series of three sessions four to six weeks apart, according to the practice's published guide. Larger treatment areas, add-on regions such as the neck or submentum, and combination protocols sit at the higher end of that range.

What drives the price, and how Morpheus8 compares. Morpheus8 is an InMode radiofrequency (RF) microneedling device that delivers energy below the skin's surface; unlike traditional microneedling, which works mechanically at the surface, RF microneedling adds controlled heating for deeper remodeling, which is the main reason its per-session cost runs higher. Pricing variation across Staten Island providers typically reflects the number of passes, the treatment area, and whether numbing and post-care are included.

Treatments at the Staten Island location are performed by board-certified providers and licensed nurse practitioners on an InMode Morpheus8 system.

"Patients ask first about cost and then about how many sessions they actually need, so we publish both up front rather than quoting per-call," said [Provider Name], NP-BC, the Staten Island clinical lead at Lov MedSpa. "For most skin-tightening goals on Staten Island we plan a series of three treatments, and we tell patients to expect gradual collagen remodeling over the following three months."

"Standardizing our Morpheus8 protocol across five locations in three states is what lets us hold consistent pricing and consistent outcomes at the Staten Island site," said Nicholas Smith of Lov MedSpa.

The North Shore location serves patients across St. George, Stapleton, Todt Hill, New Brighton, and the Hylan Boulevard corridor, with treatment options including InMode Morpheus8 RF microneedling, CO2 and other laser resurfacing, HydraFacial, and the practice's PRP-based protocols.

Demand for non-invasive skin treatments continues to climb: the U.S. medical spa market reached $24.2 billion in 2025 and is projected to grow at a 15.9% compound annual rate through 2033, with facial treatments holding the largest revenue share at 53.6% (Grand View Research, https://www.grandviewresearch.com/press-release/global-medical-spa-market). Morpheus8 is an FDA-cleared device for subdermal coagulation.

A detailed Staten Island Morpheus8 cost and sessions guide is available on the Lov MedSpa newsroom at [https://lovmedspa.com/newsroom/morpheus8-staten-island-2026] (must be live before release).

About Lov MedSpa — Lov MedSpa is a nurse-owned, physician-supervised medical aesthetic practice with locations in New York, Florida, and Connecticut.

Contact: [Name] · [Phone] · [Email] · lovmedspa.com

### 7d. DRAFT 2 — HydraFacial + Morpheus8, Aventura
*(~610 words. Same fill/verify rules. Confirm HydraFacial's exact FDA status — "cleared" vs "registered.")*

**Headline:** Lov MedSpa Details 2026 HydraFacial and Morpheus8 Cost Ranges for Aventura, Sunny Isles and Bal Harbour

**Dateline:** AVENTURA, FL, UNITED STATES, June 19, 2026 /EINPresswire.com/

Lov MedSpa has published 2026 cost ranges for HydraFacial and Morpheus8 at its Aventura-serving location, listing HydraFacial sessions at roughly $225 to $350 and Morpheus8 radiofrequency microneedling at roughly $700 to $1,500 per session, for patients across Aventura, Sunny Isles Beach, Bal Harbour, Williams Island, and Hallandale Beach (ZIPs 33160, 33180).

How much does a HydraFacial cost in Aventura in 2026? A standard HydraFacial in the Aventura area generally runs about $225 to $350, while extended or add-on protocols (booster serums, LED, lymphatic add-ons) reach the upper end. Sessions are commonly scheduled monthly for maintenance.

How much does Morpheus8 cost, and how is it different? Morpheus8 in the Aventura market generally ranges from about $700 to $1,500 per session, with most skin-tightening plans built as three sessions four to six weeks apart. Where a HydraFacial is a same-day resurfacing-and-hydration facial with no downtime, Morpheus8 is an InMode RF microneedling treatment that remodels deeper tissue over roughly three months, which accounts for the higher per-session cost.

HydraFacial and Morpheus8 treatments at the Aventura location are performed by licensed, physician-supervised providers on FDA-cleared systems.

"Aventura patients often combine a monthly HydraFacial with a Morpheus8 series, so we publish both prices together to make planning straightforward," said [Provider Name], [credential], Florida clinical lead at Lov MedSpa. "The two treatments do different jobs — one maintains the skin's surface, the other remodels deeper structure."

"Operating a five-location group across three states means our Aventura pricing and protocols match what we run in New York and Connecticut," said Nicholas Smith of Lov MedSpa.

The location serves Aventura, Sunny Isles Beach, Bal Harbour, Williams Island, North Miami Beach, and Hallandale Beach, with services including HydraFacial, InMode Morpheus8 RF microneedling, Botox, Dysport, dermal fillers such as Juvéderm and Restylane, and laser treatments.

The U.S. medical spa market reached $24.2 billion in 2025 and is projected to grow at a 15.9% compound annual rate through 2033, with facial treatments — the category that includes HydraFacial — holding the largest revenue share at 53.6% (Grand View Research, https://www.grandviewresearch.com/press-release/global-medical-spa-market). HydraFacial and InMode Morpheus8 are both FDA-cleared.

A full 2026 Aventura cost guide is available on the Lov MedSpa newsroom at [https://lovmedspa.com/newsroom/hydrafacial-morpheus8-aventura-2026] (must be live before release).

About Lov MedSpa — Lov MedSpa is a nurse-owned, physician-supervised medical aesthetic practice with locations in New York, Florida, and Connecticut.

Contact: [Name] · [Phone] · [Email] · lovmedspa.com

---

## 8. The experiment that converts this from inference to fact

The whole plan optimizes a *proxy* (retrievability). Nobody has confirmed Lov is actually **cited — let alone recommended** — by a live engine. Run this single-variable factorial before scaling spend:

- **Unit:** city×service×variant, using low-competition wedges (Staten Island, Aventura + 2–3 soft micro-geos) so competition is ~constant.
- **Isolate ONE feature per pair** (don't pit "rich vs thin" — too many variables): Pair A stats/prices on/off; Pair B inline citations on/off; Pair C attributed-ranking vs plain factual; **Pair D fresh re-fire vs not** (isolates freshness from wording).
- **Randomize** feature-present across cities; counterbalance.
- **Measure the RIGHT outcome — live citation AND named recommendation**, not retrieval. Automate a daily citation-tray capture across **ChatGPT web, Perplexity, Google AI Mode** (you have Chrome/Playwright MCP). Primary metric: binary **recommended/not** + citation share, per engine.
- **Pre-register** prompts/engines/decision rule before firing; log confounds (DR of pickups, # of copies, competing fresh content).
- **Run Pair D + the citation-vs-recommendation probe FIRST** — cheapest, highest-information; they answer the two questions the whole corpus left open ("is it freshness or words?" and "are we even cited/recommended?"). ~8 releases ≈ $1.2k.

---

## 9. Risk register — read before scaling (sorted by severity)

| # | Risk | L×I | The point |
|---|---|---|---|
| **R1** | **Cited but recommends competitors** (Lily Ray) | **20** | AI cites self-promo pages but recommends rivals ~69% of the time, giving the slot to whoever has stronger *off-domain consensus*. **Change the KPI to "named/recommended," not "cited."** Reallocate budget toward GBP + real reviews + earned mentions — the consensus drivers — not just the wire asset. Never publish a self-ranking listicle that includes Lov. |
| **R2** | **Half-life / re-fire economics** | 15 | Wire = small share that halves every ~3–4 weeks (ChatGPT 3.4 wks). You're paying every 4–6 weeks to keep alive a citation that (per R1) may help a competitor. Treat EIN as perishable seeding; put durable value in the owned newsroom + reviews. Track cost-per-*recommended*-week. |
| **R3** | **FTC fake-review + GLP-1/health-claim legal exposure** | 15 (impact 5 — existential) | Fake/insider/AI reviews → up to **~$53k/violation** (rule effective Oct 2024). GLP-1: FTC settled **NextMed $150k** (July 2025) over deceptive GLP-1 claims + fake reviews; **Lilly/Novo** file NAD challenges against med-spa compounded-semaglutide marketing. **Kill the fabricated "99.4 AAAPA score" everywhere now.** No review number ships unaudited. GLP-1 stays drug-free + service-framed, zero efficacy in brand voice. One legal review of the template by med-spa-ad counsel. |
| **R4** | **Google site-reputation-abuse / newswire deindexing** | 9 | Wire syndication = textbook "third-party content on a host to borrow ranking signals." Manual-only today, but Google has stated intent to go **algorithmic** — which would scale down to the newswire long tail. The owned newsroom (first-party) is the safe harbor; keep it genuinely substantive. |
| **R5** | **Frontier models resist this** | 8 | The Princeton lifts were single-doc 2023 GPT-3.5. C-SEO Bench (2025) found the tactics are **mixed/model-dependent, sometimes counterproductive** across GPT/Gemini/Claude in competitive settings; GPT-5/Claude-class are "substantially more resistant." Only 11% citation overlap ChatGPT↔Perplexity → per-platform tactics. The tactics that survive strong models are the *non-manipulative* ones (real numbers, real consensus). |

**Shelf life, honest:** the PR-citation-centric tactic has ~12–24 months of declining usefulness and is **already partly obsolete on its primary KPI** (cited ≠ recommended). The durable core that survives all five risks: real reviews at volume, genuine third-party mentions, an accurate first-party newsroom, truthful numbers/credentials. The money is currently on the perishable shell; the surviving value is in the under-invested durable core.

---

## 10. The action plan

1. **Remediate now (R3):** delete the fabricated "99.4 AAAPA score" and any "#1/best" self-claims from `lovmedspareviews.com` and anywhere else — it's a standing liability that can drag the compliant releases down. Retire the decaying Wave A superlative headlines.
2. **Stand up the owned newsroom** (`lovmedspa.com/newsroom/...`) with per-city/service pages, JSON-LD (Article + FAQ), real tables — this is where durable value and the ChatGPT ~18% lever live. Mirror every release here (unique phrasing) *before* it fires.
3. **Ship Drafts 1 & 2** (Morpheus8 Staten Island, HydraFacial+Morpheus8 Aventura) on EIN after filling/verifying placeholders. Plain-text question lead-ins, no tables, real review numbers or none.
4. **Run the §8 experiment** (start with Pair D + the recommendation probe) before buying article #3+.
5. **Shift the KPI to "is Lov the *named* answer"** and start building the off-domain consensus (GBP optimization, real review velocity, earned local mentions) that actually moves recommendation.
6. **Re-fire winners every 4–6 weeks**, re-dating and refreshing the numbers. **Keep GLP-1 deferred** until a single drug-free probe clears.

---

### Source index
EIN guidelines · Princeton GEO (arXiv 2311.09735, + sandboxseo.com critique) · BuzzStream/SEJ syndicated-PR share · ALM owned-newsroom 18% · Trakkr/Stacker half-life · Ahrefs brand-mention r=0.664 · Metehan RRF playbook · Grand View med-spa market · Lily Ray self-serving-listicle study (Search Engine Land) · FTC fake-review rule + NextMed GLP-1 settlement · Google site-reputation-abuse policy · C-SEO Bench (arXiv 2506.11097). Full URLs in the workflow transcript.
