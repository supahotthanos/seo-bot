# The Med-Spa On-Site SEO/AEO Framework (June 2026)

> The canonical recommendation for a med-spa website, expressed as **checkable rules**.
> The `seo-bot` enforces the auto-fixable ones (gated behind `vertical: "medspa"` in the
> client config); the legal-sensitive ones are **flag-only** for a human/legal review.
> Verified via the `medspa-seo-framework-recon` workflow. Pairs with `aeo-deep-research-2026.md`
> (strategy) and `inhouse-seo-engine-plan.md` (tooling).

## 0. The order of operations (what actually moves the needle)

1. **Server-rendered HTML** (binary — AI crawlers don't run JS). Without this, nothing else counts.
2. **The free entity graph**: Google Business Profile + **Apple Business Connect** (the underused 2026 edge — feeds Siri/Apple Intelligence "World Knowledge Answers") + Bing Places. Exact NAP.
3. **MedicalBusiness schema + per-service Service/Offer + FAQPage + ReserveAction.**
4. **YMYL E-E-A-T**: named medical reviewer + credentialed author bylines + real citations.
5. **Answer-first content**: 40–60 word capsule + question headings + freshness.
6. **Booking wired** (Boulevard/Vagaro embed + Reserve-with-Google) with NAP matching GBP.
7. **Off-site** (the agency's job): reviews at volume (compliantly), citations, earned mentions.

## 1. Schema (the machine-readable layer)

- **Use `MedicalBusiness` or `MedicalClinic`** (both extend `LocalBusiness`). `HealthAndBeautyBusiness`/`DaySpa`/`BeautySalon` are **non-medical** and wrong for a med spa. → rule `medspa-schema-type` (critical).
- **NAP in schema**: `postalAddress`, `geo`, `telephone`, `openingHoursSpecification`. → `medspa-nap-schema` (high).
- **Per-service pages**: `Service` or `MedicalProcedure` + `Offer` with `priceRange` (real prices only — never invented). → `service-offer-pricing` (high).
- **Providers**: `Person`/`Physician` JSON-LD with credentials. → `provider-schema` (medium).
- **FAQ**: `FAQPage` where Q&A exists. → `faq-schema-missing` (medium).
- **Booking**: `ReserveAction`/`potentialAction` → the booking URL (also enables Reserve-with-Google). → `booking-action` (medium).
- **Reviews**: `AggregateRating`/`Review` **only if corroborated by real, visible reviews** (FTC 16 CFR 465). → `review-authenticity` (high, **flag-only — never fabricate**).

## 2. YMYL / E-E-A-T (med-spa content is "Your Money or Your Life")

- **Medical reviewer**: "Medically reviewed by [Name], NP-BC" + `dateReviewed` on treatment pages. → `medical-reviewer` (high).
- **Author credentials**: byline linking to a real provider/team bio. → `author-credentials` (high).
- **Real citations**: FDA clearances, ASPS/AmSpa stats, peer-reviewed refs (never fabricated authority).
- **Freshness**: service/location pages re-dated on **real** updates (fake date-refresh is veto-listed). → `medspa-freshness-ai` (medium).

## 3. AEO (getting cited by answer engines)

- **Answer capsule**: 40–60 word direct answer to the page's core question, first. → `answer-capsule-medspa` (high).
- **Question headings** ("How much does Morpheus8 cost in {city}?") — each maps to a query-fan-out sub-query.
- **Comparison sections / tables** ("Morpheus8 vs microneedling") — out-cite prose.
- **Non-promotional tone** — promotional/commodity tone correlates negatively with citation; never self-rank "#1/best".

## 4. Local (med spas live or die on the map pack)

- **Exact NAP everywhere** (the canonical record is the source of truth — see the citations worklist).
- **Embedded map**, neighborhood/city relevance, per-location pages.
- **The free entity graph first** (GBP/Apple/Bing), then aggregators (Data Axle/Foursquare), then AI-cited directories (Yelp/RealSelf/Healthgrades/Zocdoc). Run `node seo-bot/bin/seo-bot.mjs citations <client>`.

## 5. Medical-ad compliance (hard gates — flag-only, never auto-edited)

- **No fabricated reviews / AggregateRating** — FTC Consumer Reviews Rule 16 CFR 465 (up to ~$53k/violation). → `review-authenticity`.
- **No incentivized / gated / in-lobby review solicitation** — Google early-2026 suspension risk; FTC fined a business **$4.2M** for gating (AmSpa). The bot tracks review *counts* but never automates *solicitation*.
- **Before/after imagery** needs a "results may vary / individual results" disclosure + written FTC + HIPAA consent. → `before-after-disclaimer` (critical, flag-only).
- **GLP-1 / Rx**: no "same active ingredient as Ozempic"-style phrasing (FDA compounded-GLP-1 crackdown post-shortage). → `glp1-rx-claims` (critical, flag-only).
- **No absolute medical claims** (guaranteed/permanent/100% safe/cure). → `health-claim-superlatives` (flag-only).
- **State rules vary** (TX/CA/NY/FL) — the bot catches federal landmines and flags a "state-specific review" note; it does not certify full compliance.

## 6. How the bot enforces this

Set `"vertical": "medspa"`, `"servicePathRe"`, `"locationPathRe"` in the client config. The audit runs the 14-rule pack; **rules 1–8, 13, 14 are auto-fixable** (schema/headings/freshness/markup/booking — applied via the Next.js PR / WordPress REST adapters, human-approved); **rules 9–12 are flag-only** (reviews/before-after/GLP-1/superlatives — routed to a human/legal queue, never auto-edited). The recurring loop re-checks all of it; the citations worklist tracks the off-site listings.

> ⚠ Low-confidence, verify-before-enforcing (single-source): the exact "$145–$73,011 HIPAA per-occurrence" figure, the "April 2026 on-premises-solicitation penalty", and Boulevard's "Reserve-with-Google needs Premium +$150/mo" all came from single industry blogs — confirm against developers.google.com (GBP policy), HHS (HIPAA), and the client's actual Boulevard plan before the bot enforces or cites them.
