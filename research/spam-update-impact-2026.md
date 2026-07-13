# Google spam-update impact 2024→2026 + risk-check of this bot

8-agent live-web research (2026-06-28), triggered by the June 2026 spam update video. Sources at bottom.

## June 2026 spam update (the trigger)
- Rolled out **June 24–26, 2026** (~2 days), global/all languages, 2nd spam update of 2026. SpamBrain
  **enforcement of EXISTING policies** — no new rules. Barry Schwartz confirmed with Google: **link spam
  and site-reputation-abuse (parasite SEO) are EXPLICITLY EXCLUDED** from this wave.
- **Targets:** scaled content abuse (incl. "using generative AI to generate many pages without adding
  value"), scraped content, cloaking, sneaky redirects, doorway pages, hidden text, keyword stuffing,
  expired-domain abuse.
- **Magnitude:** the 25–50% (up to 80–90%) drops are SELF-REPORTED by worst-hit forum users, not measured
  averages — Google disclosed no aggregate. **Rank trackers (Mozcast/Semrush/Sistrix) are structurally
  blind to spam updates** (fixed keyword pools exclude the spam sites hit) → tool "volatility" understates it.
- **Recovery:** sitewide action; Google says reassessment after a fix "can take many months."

## The 2024→2026 arc (one thesis: rankings must be EARNED by serving users, not by exploiting trust signals)
- **Mar 2024:** Helpful Content folded into core + launched scaled-content / site-reputation / expired-domain policies (837 sites deindexed).
- **Nov 2024:** site-reputation-abuse hit affiliate sections — Forbes Advisor ~ **-1.4M visits (~-$8.6M)**, CNN Underscored, WSJ Buyside, USA Today coupons.
- **Aug 2025:** PBN / exact-match-anchor link schemes (Sterling Sky), retroactively penalizing 5-yr-old links.
- **May 15 2026:** **AI-citation manipulation** ("buying or altering citations" + inauthentic brand-mention networks) classified as spam for the first time.
- **June 2026:** enforces the content-level layer.

## What got PENALIZED
- Scaled/programmatic page networks built primarily to rank — **templated location pages (city-swap)**, comparison/glossary/"best-X" mills, FAQ-farms (1 Q/URL). (Lily Ray's 8 high-risk templates.)
- AI content **without** human editorial review / named credentialed author / original data (Grokipedia 885K AI pages → full collapse Feb 2026; izoate -89%; CNET pre-fix; Lily Ray: 54% of AI-content sites lost ≥30%).
- Fabricated / near-duplicate content (Grokipedia 96% Wikipedia match, fabricated citations). **page-count ≫ engagement** is a SpamBrain red flag.
- Doorway nets (88% of doorway URLs never ranked); thin affiliate/coupon; expired-domain & PBN abuse.
- **High ad-density** (ads:content >25%; fixed-ad placement r=-0.522 — strongest single negative signal); push-notification popups (zero winners used them).
- High-DA / low-BrandAuthority (Moz: losers BA≈37 vs winners 50–52) — links without genuine branded demand.

## What SURVIVED
- Programmatic pages with **genuinely unique proprietary data per page** (Wise 10M pages, Zillow, Tripadvisor, Zapier) — vs G2 crashing 12M→1M when review pages thinned.
- **AI-assisted + mandatory human review + named credentialed author + original first-hand data** (Bankrate stable; CNET recovered after reinstating review; Rankability: AI page deindexed → human rewrite → top-10 in hours).
- First-hand experience ("we tested / I found" r=0.383; original photos r=0.333) — author boxes WITHOUT real experience = "theater" (no significance).
- Original proprietary research/data (the one thing AI can't generate; May 2026 core elevated primary sources over aggregators).
- **Local:** map-pack rankings stayed stable across spam updates; only ORGANIC templated "service-in-city" pages fell (one HVAC -63% in 30 days; a 487-review HVAC contractor GAINED +73%). Local was the most resilient cohort in Dec 2025 (24% affected vs 67% health/medical). Per-location pages survived ONLY with real local prices / named local provider / real reviews / city-specific notes. **AI Overviews were removed from local "near me"/provider queries by Dec 2025** but still dominate clinical-informational queries.

## RISK-CHECK of this bot (what aligns vs what to fix)
- ✅ **SAFE — hard publish gates** (no-fabrication, verified named reviewer, primary-source-only citations, originality dedup): a near-exact mirror of what survived; kills the Grokipedia/CNET-unreviewed/fabricated-stat patterns.
- ✅ **SAFE — nothing auto-publishes** (one-click human approve → PR-only): editorial review is THE survivor discriminator.
- ✅ **SAFE — funnel-hack rules are audit/flag-and-propose** (geo-slug never auto-rewrites; scaffold flags only missing sections; keeps thin-content guard).
- ⚠️ **RISK — the programmatic service×geo content PLAN** (`contentPlan`) is structurally the "templated location-page network" cohort June 2026 hit hardest. Biggest exposure.
- ⚠️ **WATCH — `local-specificity` soft gate** rewards the city TOKEN (~2 mentions), not city-specific VALUE — what swapped-city templates pass.
- ⚠️ **WATCH — originality dedup never runs on siblings** (`priorTexts:[]` everywhere) → generated location pages are never compared to each other. **(fixed — see below)**
- ⚠️ **WATCH — PR-wire / citation cadence** sits adjacent to the new May-2026 AI-citation-manipulation policy.
- ⚠️ **WATCH — freshness re-date** integrity is enforced only by a code comment, not a content-diff check.

## Recommended adjustments (priority order)
1. **Dedup siblings** — accumulate drafted pages + pass as `priorTexts` so the originality gate compares generated location pages to each other (was `priorTexts:[]` everywhere → never compared). **(DONE, tested)**. _Nuance: the 0.86 shingle threshold reliably catches duplicate / long near-dup pages, but a SHORT city-swap template can still slip it — so #2 (plan cap) and #3 (local-VALUE gate) are the primary templated-page defenses, not dedup alone._
2. **Plan-level scaled-content cap** in `contentPlan`/`contentBatch` — cap pages per geo + total programmatic vs site size; refuse to mass-plan.
3. **Promote `local-specificity` to a value check / hard gate for programmatic geo pages** — require ≥N city-specific facts (real local price, named local provider, neighborhood), not just the city token.
4. **Enforced jittered publish-velocity throttle** in code (3–5/wk, randomized) — publication-velocity anomaly is a named SpamBrain signal.
5. **Fake-refresh integrity guard** — a `dateModified` bump must be accompanied by a real body-text diff.
6. **AI-citation-manipulation brake** on the PR-wire/superlative cadence (May 15 2026 policy).
7. **Unique-purpose + ad-density / intrusive-UX guards** in `auditPage` (strongest measured loser signals).

_Sources: Google Search Status (June 2026 incident) + spam-policies docs; Search Engine Land / Roundtable (Schwartz: link-spam + parasite EXCLUDED) / Journal (May-2026 AI-citation policy); digitalapplied (tracker blindness); Mar-2024 + Nov-2024 Google blog + Adweek (Forbes -1.4M); Sterling Sky (Aug-2025 + local 2026); Lily Ray (8 templates); Grokipedia case study; Zyppy (first-hand + ad-density signals); ALM (Dec-2025 YMYL vs local); BrightEdge (AIO removed from local); Moz/PPC.land (BrandAuthority)._
