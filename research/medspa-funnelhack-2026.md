# Med-spa SEO/AEO funnel-hack — what actually wins (live teardown, 2026)

Reverse-engineered from the clinics that rank organically AND surface in ChatGPT/Perplexity/Google-AIO for
"best med spa in <city>" across 12 cities (Atlanta, Miami, Scottsdale, Dallas, Houston, NYC, Chicago,
Austin, Nashville, Denver, Beverly Hills, San Diego) + Via/VIO teardown + Edward Sturm + AEO research.
Gap-checked against our KB + bot rules. **Most winning on-page/AEO tactics we already cover; the items in
"NEW RULES" below are the implementable gaps.**

## Winning playbook (recurring across all 12 cities)
1. **Title = ranking weapon.** `[Treatment] in [City], [State] | [Brand]` baseline; top sites stack an
   ATTRIBUTED superlative or `| [Month Year]` freshness token. (Bare "#1/best" in BODY still backfires —
   attributed superlatives belong in the TITLE.)
2. **Geo modifier in every URL slug** (`/scottsdale/botox/`, `/botox-dallas/`, dual-city slugs). Most
   consistent single tactic.
3. **Service page = fixed 12–16 section H2 scaffold** (ELLEMES 16 / Blume 28 H2 / Sanjiva 4–5k words):
   What is it → Candidate → How it works → Timeline → Downtime → **Cost in [City] (range)** → Who performs
   it (named credentialed provider) → Comparison vs alternative → FAQ (5–14) → inline reviews → CTA.
4. **Transparent pricing = the #1 AEO trigger.** Exact unit/tier prices in body AND inside FAQ answers
   ("Botox $14/unit, member $11.20"). AI preferentially cites "how much does X cost in [city]".
5. **Named credentialed provider card ON the service page** (MD/NP/PA + board cert + years + photo +
   rating); attributed FAQ ("BOTOX FAQs With Lauren Amico Reed, PA-C").
6. **Physician/credential authority in title + entity** (MD-led > NP > unnamed; Allergan Diamond/Black
   Diamond tier, "Top 250 of 45,000 Allergan providers", Castle Connolly).
7. **Hub-and-spoke + dual taxonomy** (condition pillars → treatment spokes; by-category AND by-concern nav;
   per-device pages: Sciton BBL vs MOXI vs SkinTyte).
8. **Multi-location programmatic scale** (VIO ≈ 2,800 location×service pages w/ FAQPage schema, canonical
   generic anchors, KML geo-sitemap). Per-location unique NAP + provider roster + AggregateRating.
9. **Neighborhood carpet-bombing** from a single location ("Communities We Serve": Buckhead, Midtown,
   Brookhaven…) to capture "near [neighborhood]" without new pages.
10. **Freshness as acquisition** — date-stamped titles, "Last medically reviewed [date]" + PubMed cites,
    monthly promo pricing. (<30-day content ≈ 3.2× more cited by Perplexity.)
11. **Comparison / versus content** (Botox vs Dysport, Morpheus8 vs Secret RF) = AI disambiguation bait.
12. **Off-page = PR-wire cadence + review velocity (100+ @ 4.5+, 8–10 fresh/mo) + directory/entity
    stitching** (RealSelf, Healthgrades, Yelp, Wikidata QID, sameAs).

## Copywriting / tone (distilled — for our blog + page generation)
- **Education-first, anti-salesy authority; "guided, not sold to."** Specificity beats superlatives:
  exact providers, credentials, review counts, prices, recovery timelines — NOT bare "best/#1" in body.
- Lead with OUTCOME, then mechanism (8th-grade, sentences < 20 words). Outcome language > equipment language.
- **Answer-capsule first paragraph** (40–60w, ≤17-word sentences): treatment + city + who performs + price range, in first 30%.
- Question-form H2s phrased exactly as patients ask. Replace "minimal downtime" → "2–7 days of possible bruising"; "affordable" → "$14/unit".
- **Anti-overfill / natural-results brand spine** repeated site-wide (converts skeptical YMYL searchers).
- Founder/physician narrative as trust anchor; credentials in body, not buried in /about.
- Inline review embedding at the point of conversion; ranges inside FAQ answers; reassurance-first CTAs ("free, no-pressure consultation").
- Seasonal/timing blog framing ("Winter is best for chemical peels") for low-competition intent.

## Article/service-page blueprint (the winning 2026 scaffold)
URL `/[treatment]-[city]/` (geo in slug). Title ≤60ch keyword-first + optional attributed superlative / `| Month Year`.
Meta 50–160ch lead with answer + price range. H1 exact-match `[Treatment] in [City], [State]`.
1. Answer capsule (40–60w) · 2. What is it · 3. Candidate · 4. How it works (consult→procedure→aftercare) ·
5. Results timeline (Day 1-7 / Wk 2-4 / Mo 1-6) · 6. Downtime (specific) · 7. **Cost in [City] (range)** ·
8. Who performs it (named provider card) · 9. Comparison vs alternative · 10. FAQ (5–14 Q&A, prices in answers) ·
11. Inline reviews · 12. Reassurance-first CTA. Target 2,000–4,500w for head terms; each section a self-contained answer island.

## NEW RULES to add to the bot (gaps vs winners — all flag-and-propose, safety-preserving)
- `medspa-geo-slug` — service/location slug must contain city (+treatment) modifier. **Never auto-rewrite URLs; propose w/ 301 plan.**
- `medspa-cost-answer` — visible "how much does X cost in [city]" heading + price-RANGE answer-block (not just Offer schema). **Real prices only (human input).**
- `medspa-scaffold` — service page covers the high-value sections (candidate/how-it-works/recovery/cost/provider/comparison/FAQ). Flag only MISSING; keep thin-content guard.
- `medspa-provider-card` — named credentialed provider (+ attributed FAQ) ON the service page.
- `medspa-authority-claim` — board cert / Allergan Diamond / fellowship / award / volume counts present as citable authority. **Detect-only; never fabricate.**
- `medspa-comparison-gap` — at least one treatment-vs-treatment comparison page. **Treatment-vs-treatment only (no named competitors → defamation).**
- `medspa-neighborhood-coverage` — single-location pages mention ≥N adjacent neighborhoods (cfg.neighborhoods). **Cap mentions (anti-stuffing).**
- `medspa-entity-sameas` — Organization/MedicalBusiness JSON-LD has a sameAs[] (GBP/Yelp/RealSelf/Healthgrades) + ideally Wikidata QID.
- review-date + citation refinement to `medical-reviewer` — reward a visible review DATE adjacent to the reviewer + ≥1 real authority citation.
- multi-location template detector — if multi-NAP/`/locations/`, audit per-location uniqueness (NAP + roster + AggregateRating) + canonical.

## Already covered (verified strong vs winners)
answer-capsule, question-headings, GEO-evidence (stats/quotes/cites), passage self-containment, MedicalBusiness
schema, NAP schema, Service+Offer pricing schema, named medical reviewer + dateReviewed, provider schema,
ReserveAction booking, AI-crawler allow-list, review-authenticity (FTC flag-only), before/after + GLP-1 + health-claim
legal gates, promo-tone penalty, freshness, PR-wire system. **Our passage linter is stronger than any competitor signal observed.**

_Source: 16-agent live teardown workflow, 2026-06-28. Full raw in the session task log._
