# The founder Google runbook — running lovmedspa's SEO with zero hires

**Who this is for:** the founders operating a med spa's Google presence with the bot doing
the machine work. **Your total time: ~2–3 hours/week.** Everything not on this page runs
itself (audits, drafts, tracking, PRs) or lands in your weekly Slack card / the dashboard
`/todo` page as a specific task with a why and a how.

Evidence discipline: every play below cites its source tier. Nothing here is folklore —
it's the encoded model (`src/tactics/registry.mjs`, `src/local/factors.mjs`,
`research/local-ranking-factors-2026.md`, `research/spam-update-impact-2026.md`).

---

## The weekly cadence

**Monday, 10 min — read the card.** The Slack "📋 Your SEO week" card (or `/todo` on the
dashboard) lists at most 5 tasks, effort-sized, evidence-linked. Do them during the week.
Tasks that can verify themselves will check themselves off; regressions reopen loudly.

**Daily, ~5 min — the review ask (the single highest-ROI habit).**
- The ONLY compliant flow (FTC 16 CFR 465 — violations run ~$53k each; Google suspends for
  gating): **a verbal ask, ~24h after treatment, to every patient** — never filtered by
  how happy they seem (no gating), never paid/discounted (no incentives), never automated
  by us (the bot measures; humans ask).
- Ask them to **name the service** ("mention it was Botox with Jane") — reviews that name a
  service become query-matched snippets in the map pack [ground-truth: Sterling Sky].
- Rhythm beats volume: rank contribution decays on an ~18-day half-life, so one review a
  week forever beats ten in launch week [ground-truth: Sterling Sky]. Under 10 total
  reviews? Getting to 10 gives a measured bump [ground-truth].
- **Respond to every review** — warmly, briefly, and (HIPAA) never confirming the reviewer
  was a patient or naming their treatment in your reply. No keywords stuffed into replies
  (debunked — reads as spam, does nothing).

**Content, ~30–45 min/wk — approve, don't write.** The bot drafts 2–3 posts/week max
(jittered cadence, enforced in code). Your job: the medical read on YMYL drafts in the
approvals queue — is every claim true, every price real, the named reviewer actually you?
Merge = publish. Never push volume past the caps; scaled templated content is what the
June-2026 spam update demoted [large-n: Lily Ray cohort — 54% of AI-template sites lost 30%+].

**GBP, ~15 min/wk — the owner surface.** The bot cannot (and should not) touch your
Business Profile; it flags, you apply. The checklist it audits against
(`src/locations.mjs gbpFanout`):
- **Primary category = "Medical Spa"** — the #1 local ranking factor [ground-truth:
  Whitespark LSRF 2026]. Secondary categories up to the 10 ceiling, adjacent + defensible
  only (wrong categories are a suspension vector).
- **Services list populated with real prices** (services fields affect rank [ground-truth:
  Sterling Sky retest]).
- **Hours accurate** — "open at time of search" is the #5 factor; never list hours you
  don't keep. Evening/weekend coverage is a business decision, not an SEO trick.
- **Address visible** — hiding it drops SABs; revealing recovers in ~a month [replicated].
- **10+ real photos** (exterior/interior/team/results-with-consent). Geo-tagging photos is
  debunked — Google strips EXIF.
- **GBP website link → the location page, NOT your strongest organic page** (the
  Diversity-Update dedup demotes both when they're the same) [ground-truth: Sterling Sky].
- Q&A: seed + answer real patient questions yourself (owner-answered is fine; fake
  personas are not).
- GBP Posts: fine for offers/conversion; they do NOT move rank (debunked) — don't do them
  "for SEO".

## The monthly hour

- **Read the deep-audit report** (`reports/lovmedspa-com/deep-audit-<date>.md`) — the
  consolidated state: site health, your panel vs competitors, citation status, spam-risk
  self-check. The action plan regenerates from it.
- **Claim/fix one citation** from the tier list (the task card names it + links the claim
  page): Tier 1 first — Google Business Profile, **Apple Business Connect** (lowest
  competition, feeds Siri/Apple Intelligence), **Bing Places** (feeds Copilot) — then the
  free aggregators (Data Axle, Foursquare), then the AI-cited directories (Yelp, RealSelf,
  Healthgrades). Always the EXACT canonical NAP; paste each live URL into the config so
  drift is monitored forever.
- **Skim the geo-grid** — proximity is a hard constraint: the grid shows where you can
  realistically rank; we never chase (or promise) ranks outside the envelope.

## What the machine does (so you don't)

Site audits (60+ rules incl. the med-spa/YMYL pack) · content drafting in your measured
voice · schema/meta/technical fixes as PRs you approve · rank + AI-visibility tracking ·
citation drift monitoring · spam-risk self-checks · the task ledger that checks work off
when the evidence goes green. All writes to the site flow through PRs; YMYL/legal changes
are always held for a human.

## The NEVER list (enforced in code; do them manually and the rankings you paid for become the penalty you own)

- **Fake, incentivized, or gated reviews** — illegal (FTC), suspension-grade (Google).
- Mass templated / city-swap pages; publishing bursts past the caps.
- Buying links/placements/PBNs; parasite pages; expired-domain tricks.
- Ranking yourself #1 in your own "best of" listicle (demoted cohort, Jun-2026).
- CTR bots / synthetic engagement (durable NEGATIVE, not just neutral).
- Fake-refresh date bumps without real content changes (demotion marker).
- Hidden AI-prompt text on pages (classified spam, Feb-2026; removal recovers).
- Debunked busywork: geotagged photos, GBP-posts-for-rank, service-area-field edits,
  keyword-stuffed review replies.

## The weekly verdicts (the Rank Loop — how you know it's ALL working)

Four one-glance verdicts, all on the dashboard `/todo` page and in Slack:

1. **Suite green** — the code itself (the Mini refuses to run red code; it rolls back alone).
2. **Flight 🟢/🟡/🔴** — is every lane alive? 🟡 = something's stale (look this week).
   🔴 = something's dead (it already escalated to Slack — look today).
3. **Coverage** — your action plan is current; done tasks check themselves off, regressions
   reopen loudly.
4. **Outcomes** — the scoreboard: map-pack share (the north star), clicks, AI presence,
   leads — each vs its 4-week baseline and your target. **⚠ STALLED** on the north star
   means three straight measured weeks without improvement: read the strategist's next
   bets carefully, that's exactly what they're for.

**Bet cards (🎯):** the strategy agent proposes at most 3 tracked bets a week — a concrete
action plus the metric it expects to move by a date. Its lifetime hit-rate is printed on
every card; nothing runs until you approve (`bets <client> --approve <id>`). Approve what
convinces you, reject what doesn't — a rejected bet costs nothing, an unscored guess is
worth nothing.

## When something looks wrong

Rankings dip → check `deep-audit-latest` + whether a Google update is active (the bot
freezes risky work during rollouts automatically). A negative review → respond calmly per
the HIPAA-safe pattern; never dispute genuine ones. A negative thread/press → escalate to
the reputation program; never astroturf. When in doubt: the bot proposes, you dispose —
nothing on this page ever requires acting faster than a day.
