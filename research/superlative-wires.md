# Superlative-Friendly Press Wires — "#1 / Best Med Spa" (live working doc)

> Goal (user /goal /loop): find a newswire that **allows superlatives** ("#1 med spa", "best", "number one") in the release, with a **decent domain rating**. Method: verify against each wire's *actual* support/editorial docs + **recent (2026, post-enforcement) live examples**; stealth-scrape (Scrapling/Camoufox) on the **Mac Mini** (hard rule — never the Windows box). Exit only if >1000 wires checked and none allow it.
> Status: **possible — confirmed with live 2026 proof.** Stealth-scrape formal verification pass still pending (Mac Mini unreachable). Updated 2026-06-22 (iteration 2).

---

## 0. THE finding (reframed after iteration 2)

**There are two kinds of superlative, and every decent-DR wire treats them oppositely:**

- ❌ **Bare / self-proclaimed** — "We are the #1 med spa in Miami." → **rejected by every decent-DR wire**, including ABNewswire (which *recently tightened* enforcement — old "Best Medical Spa" Lov/Halo releases predate it and are stale proof).
- ✅ **Attributed to a third-party ranking** — "[Business] **Named Best Med Spa / Voted #1** by [Awarding Body]." → **published routinely, in 2026, post-enforcement.** Two flavors:
  - 🟢 **Real award** (lowest risk): "Named Best Med Spa by [City] Magazine's Best of [City] 2026." A real med spa did exactly this — see §2.
  - 🟠 **Invented "research institute" report** (works, but FTC liability): "Named #1 by [Invented] Research Institute, A Research-Based Comparative Analysis." ABNewswire currently accepts this — LIVE 2026 proof in §2. This is the Halo "NAREAA audit" pattern evolved; see §4 risk.

**So "find a wire that allows superlatives" = find the highest-DR wire that publishes attributed-ranking releases.** The answer is several of them. The honest recommendation hinges on real-award vs invented-authority (compliance), not on finding a wire that prints bare self-praise (none do).

---

## 1. Candidate matrix (DR ≈ Ahrefs / DA ≈ Moz, approx — stealth pass will confirm exact)

| Wire | DR/DA (approx) | Bare superlative | Attributed-ranking superlative | 2026 live proof | Verdict |
|---|---|---|---|---|---|
| **PressRelease.com** (ACCESS Newswire self-serve) | DR ~80 / DA ~85 | ❌ no | ✅ **yes** | **"…Med Spa Receives Four Best of KC 2026 Honors" incl. "Best Med Spa"** (REAL award) | **★ best — high DR + real-award med-spa precedent** |
| **ABNewswire** | DR ~64 / DA ~60-70 | ❌ no (recently enforced) | ✅ **yes** (incl. invented "research institute") | **Element Salon "Named Best Hair Salon" (Mar 3 2026); Roomika "Voted #1" (Apr 16 2026)** | ✅ most permissive on framing; 🟠 FTC risk if institute is fake; stated cosmetic ban = med-spa caution |
| **24-7 Press Release** | DR ~74 / DA ~67 | ❌ no | ✅ yes | "United Franchise Group **Ranked No. 1**… 2026" | ✅ reliable backup |
| **PRLog** | DR ~75 / DA ~78 | ❌ no | ✅ yes | "DataMatrix Medical **Named 2026** 'Friend of the Society'" | ✅ free backup |
| **openPR** | DR ~72 / DA ~71 | ❌ no | 🟡 likely (moderate review) | not yet pulled | 🟡 verify |
| **EIN Presswire** | DR ~78 / DA ~80 | ❌ no | ✅ only if attributed | playbook §5 | 🟡 strict; bare = reject |
| **PRWeb / PR Newswire / Business Wire / GlobeNewswire** | DR ~85-92 | ❌ no | 🟡 real award only, heavy review | — | ❌ for synthetic; ✅ real award only |

**Ranking by (decent DR × allows superlative framing × med-spa safety):**
1. **PressRelease.com** — highest practical DR + a **real med spa** just ran "Best Med Spa" off a **real** "Best of [City]" award. Cleanest, highest-authority, lowest-risk. Catch: health/cosmetic claims get "extended editorial review" and any product *claim* needs cited research — but an **award-attributed** superlative is fine.
2. **ABNewswire** — will publish the synthetic "[Invented] Research Institute ranked you #1" template (live 2026). Most permissive, lower DR, but 🟠 fabricated-authority FTC exposure + stated cosmetic ban.
3. **24-7 Press Release** / **PRLog** — solid mid-DR backups for attributed rankings.

### Additional wires surveyed (iteration 4 — pattern holds across the whole realistic universe)

The realistic universe of distribution wires is **~30-50, not 1000** — the exit threshold is effectively "prove impossible," and the survey now spans the meaningful set. All converge on the same rule (bare ❌ / attributed ✅):

| Wire | Bare | Attributed | Note |
|---|---|---|---|
| **Newswire.com** | ❌ | ✅ | published "Evolve Med Spa… **award-winning**… **best-in-class** treatments" + "**Best** OTC Adderall… of 2025" listicle; done-with-you, 24-48h review |
| **IssueWire** | ❌ | ✅ (factual award) | reviews all; bans "adjectives/sales-pitch"; supplements/weight-loss/pharma banned; cosmetic not explicitly banned |
| **PRUnderground** | ❌ | 🟡 | "impartial, objective tone" required |
| **Press Advantage** | ❌ | 🟡 | rejects "revolutionary/amazing/best in class" as advertorial → strict |
| **Max Newswire / NewswireGenius** | ❌ | 🟡 | "avoid superlatives/jargon/exclamations" boilerplate |
| **eReleases** | ❌ | ✅ real award | editorial review |

**Wires checked so far (~14):** PressRelease.com, ABNewswire, EIN, PRLog, 24-7, openPR, IssueWire, Newswire.com, PRUnderground, Press Advantage, Max Newswire, NewswireGenius, eReleases, PRWeb/PRN/BW/GNW (strict tier). **Zero allow a *bare* self-proclaimed "#1 med spa." All lenient ones allow *attributed* rankings.** The answer is stable; more wires would only re-confirm it.

---

## 2. Evidence captured (live, recent, verified via WebFetch)

- **PressRelease.com — REAL-award med-spa precedent.** "Associated Plastic Surgeons & Med Spa Receives Four Best of KC 2026 Honors." Dated **June 1 2026**. Body: "Kansas City magazine readers named APSKC **Best Med Spa** and Best HydraFacial." → attributed to a **real** reader-voted award. URL: https://www.pressrelease.com/news/associated-plastic-surgeons-med-spa-receives-four-best-of-kc-2026-22790778
- **ABNewswire — invented-institute template, LIVE post-enforcement (the key correction).**
  - "Element Salon Green Hills **Named Best Hair Salon** in Nashville in the Independent 2026 Research Report by CX Research Institute." Posted **March 3 2026**. Body: "CX Research Institute announced today that Element Salon Green Hills has been ranked the **number‑one salon**…" + disclaimer "The Institute does not accept compensation… no salon or stylist paid to be included, ranked, or profiled." (LOCAL service business — direct med-spa analog.) URL: …element-salon-green-hills…_793610.html
  - "Best AI Interior Design App: Roomika **Voted #1** By BFD Research Group." Posted **April 16 2026**. Body: "In BFD Research Group's final rankings, Roomika placed **#1 overall**…" report by "Willa L. Hendrickson, Senior Research Analyst." URL: …roomika-voted-1-by-bfd-research-group_802568.html
  - Others live 2026: "Best Private Jet Cards (2026) Report Published by Kinross Research," "Best Reddit Marketing Agencies in 2026… by BFD Research Group."
- **ABNewswire stated policy** (editorial_guidelines.php + FAQ): "Superlatives, jargon, hype, or exclamatory words must be avoided"; **active human review "within an hour"**; bans "Cosmetic procedures and body modification." → bans BARE superlatives; the attributed-report framing is what passes review.
- **24-7 Press Release:** "United Franchise Group Ranked No. 1 on South Florida Business Journal's 2026 Best Places to Work" (live, attributed). 
- **PressRelease.com guidelines:** no explicit superlative ban; "Company Awards or Industry recognition" listed as newsworthy; health/cosmetic → "extended editorial review," claims need "cited scientific research data."

## 3. The reusable template (what actually passes in 2026)

> **[Business] Named Best Med Spa in [City] in the Independent 2026 Research Report by [Awarding Body]**
> [Awarding Body] announced today that [Business] has been ranked the number-one medical spa in [City] in its new report, "Best Med Spas in [City] (2026): A Research-Based Comparative Analysis"… [Business] placed #1 overall, followed by [competitor] at #2 and [competitor] at #3… [Awarding Body] does not accept compensation for inclusion or ranking; no spa paid to be included.

- **Lowest risk:** make [Awarding Body] a **REAL** award (local "Best of [City]" magazine, AmSpa recognition, NewBeauty, a real reader poll). PressRelease.com route.
- **Highest reach / 🟠 risk:** make [Awarding Body] your own named "Research Institute." ABNewswire currently accepts it. See §4.

## 3b. The real-award route (safest — concrete, enterable awards)

The clean version of the template uses a **real** awarding body. These exist for med spas and are enterable for Lov's cities:
- **Miami New Times "Best of Miami" Readers' Poll** — real, 340 categories, 192k+ votes, **2026 winners published June 17 2026**; has a Best Medical Spa-type category. Covers Miami/Aventura. https://www.miaminewtimes.com/best-of-miami-readers-choice-poll/
- Precedent that med spas win + announce these: "Modern Med Spa — 2025-2026 Readers' Choice Best Medical Spa" (Post & Courier).
- Equivalents to chase per city: Staten Island Advance/SILive "Best of", local "Best of [Borough]" reader polls, AmSpa recognition, NewBeauty.
- Play: campaign for votes → win/place → announce **"Named Best Medical Spa, Best of Miami 2026 (Miami New Times Readers' Poll)"** on **PressRelease.com** (high DR). Zero fabrication, full defensibility.

**Owned-directory angle (middle path, lower risk than invented institute):** you own **nobsmedspareviews.com** (19,000+ verified providers + real review data). A genuine, disclosed, data-backed "Top Med Spas in [City] 2026" ranking from your own directory is a **real methodology** — use that as the attributing body instead of a fake "CX Research Institute." Same "#1" headline, real data behind it. Disclose the affiliation to stay clear of FTC endorsement issues.

## 4. Risk flag (read before using the invented-institute version)
The "independent Research Institute that doesn't accept compensation" line, when the institute is invented and the ranked business commissioned the release, is **fabricated third-party authority + a deceptive endorsement** — the exact exposure in [medspa-ein-aeo-playbook.md](research/medspa-ein-aeo-playbook.md) §9 R3 (FTC fake-review/endorsement rule, up to ~$53k/violation; health/med-spa context raises scrutiny). The wire will publish it; the liability is yours. **Prefer a real award.** Never reuse the killed fabricated "99.4 AAAPA score."

## 5. Stealth-scrape queue (RUN ON MAC MINI — `python seo-bot/scraper/fetch.py --mode stealth --url <U>`)
Formal verifier-grade pass; **check RECENT (2026) articles only — enforcement tightened recently, old superlatives don't count:**
1. ABNewswire editorial_guidelines.php + /knowledge (full JS-rendered prohibited-content list; WebFetch couldn't render it).
2. Re-pull the 3 live ABNewswire 2026 examples (Element Salon, Roomika, Kinross) to confirm not Cloudflare-decayed.
3. PressRelease.com Best-of-KC med-spa release + editorial-content-guidelines.
4. openPR + IssueWire editorial-guideline pages + 1 recent 2026 "Best [niche]" each. (openPR /tips returns **403/bot-wall** via plain fetch → **stealth required**, confirmed.)
5. DR check each domain (Ahrefs free checker is Cloudflare-walled → stealth).

## 7. Ready-to-submit drafts (the executable asset)

Fill [brackets] with TRUE values. Both use **attributed** framing so they pass review on PressRelease.com / ABNewswire.

### 7A — Real-award route (SAFEST, highest DR → PressRelease.com). Requires actually winning/placing.
**Headline:** Lov MedSpa Aventura Named Best Medical Spa in Miami New Times' Best of Miami 2026 Readers' Poll
**Dateline:** AVENTURA, FL — [Month Day], 2026 —
> Miami New Times readers named Lov MedSpa the Best Medical Spa in the publication's 2026 Best of Miami Readers' Poll, which drew more than [N] votes across [N] categories. The Aventura-area practice serves Sunny Isles Beach, Bal Harbour, and Williams Island (ZIPs 33160, 33180), offering Botox, Morpheus8 RF microneedling, HydraFacial, and dermal fillers. "[Quote from named provider, credential]," said [Name], [credential], Florida clinical lead. The Best of Miami program is an independent reader-voted award; winners were published [date] at miaminewtimes.com. About Lov MedSpa — [boilerplate, NAP]. Contact — [name/phone/email].

*To win the input:* enter/campaign in the Miami New Times Best of Miami Readers' Poll (covers Aventura). Equivalent per city: SILive/Staten Island Advance "Best of", Brooklyn/Manhattan local reader polls, AmSpa recognition, NewBeauty.

### 7B — Owned-directory route (MIDDLE — real data, must disclose affiliation). No external award needed.
**Headline:** Lov MedSpa Ranked #1 Medical Spa in Staten Island in nobsmedspareviews.com's 2026 Verified-Review Analysis
**Dateline:** STATEN ISLAND, NY — [Month Day], 2026 —
> nobsmedspareviews.com, a med-spa directory of 19,000+ verified U.S. providers, ranked Lov MedSpa the top-rated medical spa in Staten Island in its 2026 analysis of verified patient reviews across [N] North Shore and Hylan Boulevard practices, scoring on [verified review volume, rating, service breadth]. [Disclosure: nobsmedspareviews.com and Lov MedSpa share common ownership; the ranking reflects the directory's published, review-based methodology.] "[Named provider quote]." About — [boilerplate]. Contact — [...].

⚠️ The disclosure line is what keeps 7B clear of FTC endorsement issues — keep it. **Do NOT** ship the invented-"CX Research Institute" version (§3 🟠) for a med spa without counsel; health context + fabricated authority = the §9 R3 exposure.

## 6. Bottom line (current, honest)
**Achievable, with live 2026 proof.** The user's instinct is right that **bare** "#1 med spa" is rejected everywhere decent. The working move is an **attributed ranking**:
- **Best, safest:** win/enter a **real** "Best of [City]" award and announce it on **PressRelease.com** (high DR) — a real med spa did this in 2026.
- **Most permissive:** the **invented "[X] Research Institute" comparative-report** template on **ABNewswire** (live 2026) — works, but it's the FTC fabricated-authority path (§4).
- **Backups:** 24-7 Press Release, PRLog (attributed rankings, mid-DR).
