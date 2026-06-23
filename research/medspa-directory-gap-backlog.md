# Med-Spa Directory — Competitor Gap Backlog (June 2026)

> Built from a teardown of 9 competitor directories (MedSpa Scout, Medical Spa Locator, Yelp, ThreeBestRated, RealSelf, TrustAnalytica, DiscoverMedSpa, medspa.com, AmSpa) diffed against our own repo. The dimension/synthesis agents hit the account session limit, so this synthesis + prioritization is done directly. Source teardowns: workflow `wf_4b9cdcd9-776`.

## Where we already BEAT them (do not rebuild)
- **Scale:** 18,317 spas / 718 cities vs MedSpa Scout 9.1k/348, DiscoverMedSpa ~500/30, medspa.com ~800, ThreeBestRated 3-per-city.
- **Real interactive maps** (Leaflet/OSM) — **MedSpa Scout, Medical Spa Locator, ThreeBestRated, DiscoverMedSpa, TrustAnalytica all have NO map.** Big differentiator.
- **MedicalProcedure `sameAs` Wikipedia schema** — none of them bind treatments to entities; most use generic `Organization`.
- **Editorial MSD score + 5-axis sub-ratings + sentiment synthesis** — richer than ThreeBestRated's "Inspection Report" or RealSelf "Worth It%", and ours isn't paywalled.
- **AI-visibility audit tool + quiz + contributor reviews + claim/contribute flows** — match or beat Medical Spa Locator's `/audit` and RealSelf's funnels.
- **No paid rankings** — *every* competitor sells placement (MedSpa Scout $99/mo "appear first", Medical Spa Locator $97–297/mo, RealSelf Dr. Spotlight, medspa.com $99/mo featured, Yelp Sponsored, TrustAnalytica ads). This is our headline trust wedge.

## SHIPPED this pass ✅
1. **Real photos** — scraped 7,105 first-party photos from businesses' own sites (`enrich-images.ts`), merged into `all-spas.json` (galleries + primary). Closes the "their listings have photos, ours don't" gap. (Most competitors have a single hero or none.)
2. **Profile photo gallery** (`components/SpaGallery.tsx`) — hero + thumbnails + lightbox on `/med-spa/[slug]`. Beats MedSpa Scout/DiscoverMedSpa (single/no photo).
3. **Map on profile** (`SpaMap` single-pin + Get-directions) — competitors lack this entirely.
4. **Open-now status** (`lib/hours.ts` + `components/OpenNow.tsx`) — live, timezone-aware (via state), on cards + profile + hours header. Matches medspa.com/TrustAnalytica/Yelp.
5. **Card photos + earned "Top Rated" badge** (`SpaCard`) — previously letter-avatar only.
6. **robots.txt** — added modern citation crawlers (Claude-User, Claude-SearchBot, Google-CloudVertexBot, Amazonbot).
7. **High-intent feature chips** (`lib/flags.ts`) — financing / free + virtual consult / physician-supervised / memberships / Spanish, derived from services+description, shown on the profile. *(Limited reach today — ~0.6% of spas have rich enough service/description text; would improve a lot by extracting these signals during the website scrape.)*
8. **Per-listing consultation form** (`components/ConsultForm.tsx` + `/api/consult`) — validation, honeypot, IP rate-limit, Supabase + JSONL backup, best-effort Resend email. On-brand ("we never sell your place in line"). Verified: valid→ok, honeypot→silently absorbed, missing→400.

## QUICK WINS (next — high impact / low effort)
- **Feature facets in `/search`** — now that `lib/flags.ts` exists, expose financing / consult / physician-supervised / open-now as filters (currently chips only). Bigger payoff once the scrape enriches the flag signals.
- **Enrich flag signals during the website scrape** — extend `enrich-images.ts`-style pass to capture financing (CareCredit/Cherry), "free consultation", "physician-supervised", Spanish from each site so the chips/facets actually populate.
- **Review-highlight keyword chips** — Yelp "Review Highlights (in 62 reviews)", TrustAnalytica sentiment chips. We have `sentiment.praised/concerns` + `SentimentSynthesis`; surface the top praised terms as chips on cards.
- **`AggregateRating` + `Review` + `OfferCatalog`/`Offer`/`MedicalProcedure` JSON-LD on every profile** — DiscoverMedSpa + MedSpa Scout emit OfferCatalog; confirm ours does and add `Review` objects (we show contributor/editor reviews already).
- **Year-stamped, freshness-dated titles** ("...Updated 2026") on city/best pages — Yelp/TrustAnalytica pattern; cheap AEO recency.
- **Templated long-tail internal-link mesh** — Yelp's "Affordable/Best [treatment] in [city]" + "[service] near [business]" + cross-treatment chips. Expand our footer/related linking across the 718×treatment matrix.

## HIGH-IMPACT BIGGER BUILDS
- **`/best/{top-rated|most-reviewed|first-time}/{city}` ranking-variant matrix** — MedSpa Scout's 4,039-page pSEO engine. We have `/best-med-spas/[area]`; add ranking-variant routes (sorted by rating, by review volume, by "new/first-time-friendly") with stated methodology. Pure pSEO surface.
- **Cost cluster `/cost/[service]` + `/cost/[service]/[state]` with %-vs-national + per-city table + estimator** — MedSpa Scout, DiscoverMedSpa, RealSelf, Medical Spa Locator all have deep cost tooling. We have `/service` + `/treatment/[svc]-in-[city]`; add state-level cost pages + a cost estimator (treatment × city × units → range). Strong AEO answer-box bait.
- **Distance-from-user + "near me" + radius sort** — Yelp/medspa.com/Medical Spa Locator. Client geolocation (one shared prompt → context/localStorage) → haversine vs our coords → "X mi" on cards + a distance sort + radius filter. (NEXT.)
- **Itemized per-service price menus on profiles** — ThreeBestRated/TrustAnalytica/MedSpa Scout. Data-dependent: scrape menu/pricing from business sites (extend the enrichment pipeline) → render a priced `OfferCatalog`.

## NICE-TO-HAVES
- Provider/staff profiles with credentials (RealSelf does this; most don't — lower priority).
- Before/after gallery as a distinct tab (medspa.com) — only if we can source rights-cleared images (don't scrape Places).
- "Verified License" / board-cert badges (Yelp) — pairs with our verification stance.
- A–Z provider crawl index + `WebSite`+`SearchAction` sitelinks box (RealSelf/DiscoverMedSpa).

## DO NOT BUILD (conflicts with no-paid-rankings)
- Paid "appear first" / featured / sponsored placement (MedSpa Scout, Medical Spa Locator, RealSelf, medspa.com, Yelp).
- Pay-to-verify badges (RealSelf Verified, TrustAnalytica claim-boosts ranking).
- Paid tier badges (AmSpa Platinum/Gold/Silver).
These are the exact practices our "no paid rankings" stance markets against — keep them as contrast, not features.

## Prod deploy note
Local dev reads `all-spas.json` (photos already live there). Production reads **Supabase** — to ship live:
1. **Photos:** re-run `scripts/ingest-to-supabase.ts` (the `image` column + select already exist → primary photos flow). For galleries, add an `images` (jsonb/text[]) column to `businesses` and append `images` to the select in `lib/data.ts` (`loadAllSpasFromSupabase`).
2. **Consult leads:** create a `consult_leads` table (cols: spa_slug, spa_name, treatment, timeframe, name, email, phone, message, ip, created_at). Until then `/api/consult` falls back to `data/consult-leads.jsonl` (and still returns ok).
3. **Email:** `/api/consult` uses the existing `lib/email` (Resend) — confirm `RESEND_API_KEY` is set in prod for confirmation emails.
