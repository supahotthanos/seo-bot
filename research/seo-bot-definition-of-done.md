# seo-bot — Definition of Done ("100% perfect" rubric)

> "Perfect" isn't a feeling a loop can detect, so it's operationalized here as a scored
> rubric. `node seo-bot/bin/seo-bot.mjs verify <client>` scores 0–100 against it and lists
> the gaps. The loop is **done** when a client scores **≥ 90 with zero violations and all
> hard gates green** — and each loop iteration is checked by a verifier (the bot's `verify`
> command for per-client readiness, plus a review agent for "did the build move us toward this").

## The score (0–100)

| # | Component | Pts | Done when |
|---|---|---|---|
| 1 | **Connectors live** | 20 | GA4 (7) + GSC-via-OAuth (7) + GBP (6, or 3 if pending) connected; PKCE + encrypted tokens + consent-screen In-Production are prerequisites (else capped at 10) |
| 2 | **Worksheet / config complete** | 15 | Full A–I config: canonical NAP, supervising provider+license, services+prices, promptPanel 30–50, named reviewer; NAP byte-consistent across citations |
| 3 | **Technical / audit** | 10 | audit ≥ 90, priority pages server-rendered, schema valid |
| 4 | **Citations** | 5 | tier-1 entity graph complete (GBP + **Apple Business Connect** + Bing Places), Apple led |
| 5 | **Content shipped (gated, approved)** | 20 | every published page cleared ALL hard gates + soft-avg ≥ 80, jittered human cadence; any auto-published unreviewed medical claim ⇒ component 0 |
| 6 | **AI-visibility / citations trend up** | 20 | Aleyda's 5 KPIs improving per-engine vs baseline (never blended); Sturm signals wired (GA4 AI-referral regex + GSC 7+-word regex) |
| 7 | **Statistically-significant wins** | 10 | only changes that PASSED significance at a locked horizon (stats controller) count |
| 8 | **Zero guardrail violations** | 5 (+gate) | no fabricated facts/reviews, no unreviewed medical publish, no banned GLP-1 phrases/brand drug names, no grey-hat auto-executed. **Any violation caps the whole score at 50.** |

## Hard quality bars (all must be true to certify "done")

- One-click `connect` works end-to-end for a new client in < 5 minutes.
- `worksheet` auto-generates from connect + onboard.
- The content engine is **structurally incapable of a zero-human medical publish** (YMYL = one-click-approve), and a slop draft scores 0 (verified: every hard gate fails).
- `verify` runs in the daily loop and blocks regressions.
- Trusted sources current: Gabe, Ray, King, Solis, Hawkins, **Sturm** (white-hat, the "Edward Stern" garble), Indig, Gübür; manipulators (Jacky Chou) quarantined as ADVERSARIAL_SIGNAL.

## Known non-goals / honest limits (do not pretend these are "done")

- **GBP is async** (manual approval, ~7–10 business days, profile must be verified 60+ days). Not one-click; degrades to `pending`.
- **Connector hardening pending**: add PKCE S256, encrypt refresh tokens at rest, move the OAuth consent screen to In-Production (Testing mode expires refresh tokens in 7 days).
- **YMYL is one-click-approve, never zero-human** — by design, not a gap. Auto-publishing medical claims is the client's legal liability.
- **Stats need data** — significance decisions run weekly at locked horizons, not on a wall clock.
- The med-spa-ad compliance figures from single industry blogs are verify-before-enforce.

## What the loop does each iteration

1. Build the next-highest-leverage gap (from `verify`'s gap list).
2. Test it (the bot's own commands + synthetic cases).
3. Commit.
4. **Verify**: run `verify <client>` for the score delta, and a review pass that asks "did this move the score, and do the add-ons make sense?" — if not, redo.
