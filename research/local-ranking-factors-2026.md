# Local map-pack ranking factors — consolidated 2026 model

> The P0 gap identified by `research/kb-bestofthebest-audit-2026-06.md`: the KB was
> frontier-grade on AEO + owned-site engineering but thin on the LOCAL map-pack layer —
> the Hawkins/Shaw/Gifford/Blumenthal body of controlled local studies. This file closes
> it: a consolidated factor model + a consolidated DEBUNKED list, every claim tied to a
> named operator source and an evidence tier. Encoded in `src/local/factors.mjs`
> (factor model + debunked suppressor) and `src/local/reviews.mjs` (review-velocity math).
>
> Evidence tiers used here (same scale as `src/tactics/registry.mjs`):
> **ground-truth** = controlled/replicated real-client tests or the Whitespark
> expert-consensus survey (47 experts, 187 factors, Nov-2025 edition);
> **methodology** = a named operator's tested method, not a controlled experiment;
> **survey** = expert-consensus ranking without a controlled test behind the specific claim.

---

## 1. The factor model (what actually moves the pack, ranked)

### 1.1 Primary GBP category — the #1 factor
- **Claim:** Primary category is the single strongest local-pack lever (S-Tier).
- **Source:** Darren Shaw / Whitespark Local Search Ranking Factors 2026 survey. **Tier: ground-truth.**
- **Med-spa application:** primary category = **Medical Spa** (not Day Spa / Beauty Salon —
  those also break MedicalBusiness schema alignment, see the medspa rule pack).
- **Bot check:** `signals.gbp.primaryCategory` vs the expected vertical category.

### 1.2 Proximity — a HARD CONSTRAINT, not a tactic
- **Claim:** You cannot rank a suburban office for a downtown query. Proximity to the
  searcher bounds everything else; it is a *planning gate*, not an optimization surface.
- **Source:** Whitespark LSRF (proximity consistently top-3); stated as a planning
  constraint in the KB audit (`kb-bestofthebest-audit-2026-06.md` §A). **Tier: ground-truth.**
- **Bot behavior:** geo-grid measurement (`src/geogrid.mjs` ATRP/SoLV) is the honest way to
  see the proximity envelope; content/keyword plans targeting geos outside it get flagged,
  never promised. Local proposals therefore carry `measure:{metric:'map-pack'}` so judging
  uses ATRP/SoLV instead of organic position.

### 1.3 Review signals — velocity > volume, with sharp mechanics
- **The 18-day rule (velocity decay):** rankings gained from review flow decay after
  roughly 18 days (~3 weeks) without new reviews. Steady flow beats bursts.
  **Source:** Joy Hawkins / Sterling Sky controlled tests. **Tier: ground-truth.**
- **The 10-review threshold:** a small ranking bump at 9→10 reviews; nothing at 10→11.
  Past the threshold, velocity + recency matter more than raw count.
  **Source:** Sterling Sky. **Tier: ground-truth.**
- **Review JUSTIFICATIONS:** Google surfaces exact review text matching the query inside
  the pack ("their **lip filler** looked natural"). Reviews that *name the service* create
  keyword-matched pack snippets. **Source:** Sterling Sky / Hawkins. **Tier: ground-truth.**
- **Split from the AEO threshold:** the "~150 reviews" figure is the AI-*naming* threshold
  (which engines will name you at all); the pack mechanic is velocity/recency/justifications.
  Do not conflate (KB-audit "outdated" item #3).
- **HARD LEGAL LINE:** review *solicitation automation*, gating, incentivized reviews are
  FTC 16 CFR 465 violations + Google-suspension risk. `src/local/reviews.mjs` is
  **analysis-only** — it measures velocity/justifications and mines language; it exports
  no send/solicit/request function and never will (test-asserted). Asking a patient
  verbally ~24h post-treatment is a HUMAN workflow, never the bot's.

### 1.4 "Open at time of search" — the #5 factor (2026 emergence)
- **Claim:** Whether the business is OPEN when the user searches is now the #5 local-pack
  factor. Med spas closing at 5pm lose evening/weekend high-intent searches to
  later-open competitors.
- **Source:** Whitespark LSRF 2026. **Tier: ground-truth (survey + testing).**
- **Bot check:** hours coverage in `signals.hours` (evening/weekend coverage), hours
  accuracy, and `openingHoursSpecification` in schema so engines can read them. Changing
  actual business hours is a human/business decision — the bot only surfaces the gap.

### 1.5 Visible address — the 7th factor (SAB recovery finding)
- **Claim:** Service-area businesses that HIDE their address drop in the pack; revealing
  the address recovers rankings within ~a month. Replicated. Ranked ~7th-strongest.
- **Source:** Sterling Sky (Hawkins), replicated finding. **Tier: ground-truth.**
- **Med-spa relevance:** critical for suite-based med spas (Suite 210-type addresses)
  tempted to hide the address. Show it — on GBP *and* visibly on the site (NAP text).
- **Bot check:** `signals.addressVisible` (GBP) + the `local-visible-address` site rule
  (street string from `listings.canonicalNap` present in sampled page text).

### 1.6 The Diversity-Update GBP-link fix (counterintuitive)
- **Claim:** Linking the GBP website field to your *strongest* organically-ranking page
  triggers a dedup double-demotion (Google diversifies: one strong page can cost you the
  organic slot AND the pack slot — one documented client lost 242 clicks). Link GBP to a
  relevant but NON-top-ranking page (usually the location page) instead.
- **Source:** Joy Hawkins / Sterling Sky, Aug 2024 ("Diversity Update"). **Tier: ground-truth.**
- **Bot check:** `signals.gbp.landingPage` vs `signals.topOrganicPage` — equality is the bug.

### 1.7 Secondary / semi-unrelated categories — with the 10 ceiling
- **Claim:** Additional categories are A-Tier; the "semi-unrelated category" tactic (add
  procedurally/seasonally adjacent categories, e.g. Skin Care Clinic, Laser Hair Removal
  Service) opens NEW packs. GBP caps at 1 primary + 9 additional = **10 total**.
- **Source:** Whitespark tier list (A-Tier) + Sterling Sky category testing. **Tier: ground-truth.**
- **Caveat:** categories must still be defensible — wildly wrong categories are a
  suspension vector; this is propose-for-human, never auto-set.
- **Bot check:** `signals.gbp.categories` count in [2..10]; 1 = under-used, >10 = invalid data.

### 1.8 GBP services fields DO affect ranking
- **Claim:** Services listed in the GBP Services section affect ranking (2022 retest —
  reversal of the earlier "inert" belief).
- **Source:** Sterling Sky retest. **Tier: ground-truth.**
- **Bot check:** `signals.gbp.services` non-empty and covering cfg.services.

### 1.9 Behavioral / engagement signals
- **Claim:** Direction requests, calls, website clicks, dwell, profile interactions are
  elevated as pack ranking inputs (consistent with NavBoost-style click evidence on the
  organic side). Measured via GBP Performance, not manipulable safely (CTR manipulation
  is veto-listed — see `ctr-manipulation` in tactics/registry.mjs).
- **Source:** Whitespark LSRF 2026 (elevated); DOJ/leak corroboration for click signals
  generally. **Tier: survey (directional).**
- **Bot behavior:** monitor-only (`gbp status` performance pulls); the legitimate lever is
  making the profile/page worth engaging with — never synthetic engagement.

### 1.10 LSA — AI-scored call quality (adjacent surface)
- **Claim:** Local Services Ads appear on ~31% of local queries; Google AI-transcribes and
  scores CALL QUALITY as a ranking input; missed calls redistribute leads to competitors.
  Med spas are LSA-eligible.
- **Source:** Near Media (Blumenthal) / operator reporting in the KB audit. **Tier: methodology.**
- **Bot behavior:** knowledge + worksheet item (answer rate, booking-intent call handling).
  Call handling is a human/business operation — flag missed-call rate if data is supplied;
  never automate calls.

### 1.11 Content authenticity — the swap test (supporting on-page factor)
- **Claim:** Strip the business name + city from homepage/location copy; if it still reads
  fine for any business in any city, it lacks local specificity and underperforms both in
  the pack's landing-page component and organic local.
- **Source:** Greg Gifford / SearchLab "content-authenticity test". **Tier: methodology.**
- **Bot check:** `local-generic-copy` rule — home/location pages with zero local markers
  (street/zip/neighborhood/city mentions) beyond the brand string.
- **Companion (analysis-only): review-language mining** — export reviews → cluster recurring
  phrases → reuse the *authentic* patient language in copy (`reviewLanguageTerms()` in
  `src/local/reviews.mjs`). Source: Gifford. **Tier: methodology.**

---

## 2. DEBUNKED — do not recommend, actively suppress

Consolidated so the bot can *refuse* these when they arrive from any proposal source
(LLM drafts, imported audits, operator folklore). Encoded as `DEBUNKED` +
`suppressDebunked()` in `src/local/factors.mjs`.

| id | Debunked claim | Why dead | Source |
|---|---|---|---|
| `geotagged-photos` | Geotagging/EXIF-tagging GBP photos boosts pack rank | Tested: no ranking effect; Google strips EXIF | Sterling Sky test; Whitespark F-Tier |
| `gbp-posts-for-rank` | GBP Posts move pack rankings | Tested: no ranking effect (Posts are fine for conversion, not rank) | Sterling Sky test |
| `service-area-field` | The GBP service-area field influences where you rank | Inert for ranking (display only) | Whitespark F-Tier |
| `keyword-stuffed-review-replies` | Keywords in owner review replies boost rank | Inert; wastes effort and reads as spam | Whitespark F-Tier |

(Complements the existing global dead-list: llms.txt, FAQ/HowTo rich results, 250-char
titles, cosmetic date-refresh.)

---

## 3. Measurement contract

Local/map-pack work is judged on **ATRP + SoLV from the geo-grid** (`src/geogrid.mjs`),
NOT organic position or GSC CTR — proximity makes organic metrics the wrong denominator.
Every proposal emitted by `assessLocal()` is tagged `measure: { metric: 'map-pack' }` so
the stats layer can route judgment to grid scores. Same discipline as everything else:
locked horizons, no peeking, core-update freeze applies.

## 4. What stays human (never automated)
- Review solicitation of ANY kind (FTC 16 CFR 465; module test-asserted to export none).
- Changing business hours, categories, or the GBP website link — the bot proposes with
  evidence; a human applies in the GBP dashboard.
- LSA call handling/answering.
- Suspension/reinstatement flows (Gifford's 60-minute one-shot window — human-run).
