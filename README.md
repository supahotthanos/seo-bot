# seo-bot

**An autonomous SEO/AEO engine.** It audits a site, ships fixes as pull requests behind a verifier-consensus gate, writes voice-calibrated blog posts through anti-slop quality gates, and measures how visible you are inside AI answers (ChatGPT, Google AI Overviews, Perplexity) — using real browsers, no SEO-tool APIs, no API keys required.

`1,349 unit checks · 9 integration · 12 no-cloud · MIT · Node 18+ · zero runtime deps for the core`

---

## The idea

Search is now two games: classic Google rankings and AI-generated answers. Most tooling measures one, hand-waves the other, and asks you to trust dashboards you can't audit. This engine plays both games from first principles, on your own machine, and it is built around one uncomfortable rule: **when it can't verify something, it says so and stops** — no silent guesses, no fake zeros, no auto-publishing anything a lawyer or doctor should have seen first.

## What it does

**Fix your site, safely.**
Crawl → audit (~90 rule checks incl. schema, answer capsules, internal links, CWV smells) → prioritized proposals (EV-scored) → **verifier consensus** (multiple independent model passes must agree) → **pull request**. Never a direct write. Every change is journaled with a rollback pointer, and a change-magnitude guard + before/after screenshots ride along for anything visual.

**Write blogs that don't read like AI slop.**
Brief → draft → gates: a 40–70-word self-contained answer capsule up top, near-duplicate check against your whole corpus, unsourced-price blocking, weekly publish caps, an AI-pattern lint with one humanizer rewrite pass. The register is **calibrated to the sites that actually rank** — the engine harvests the winners' blogs per market, builds a quantitative voice profile (sentence cadence, question rates, $-concreteness, reading grade), and drafts to match the register, never the words. Clean posts auto-merge their PR; anything YMYL (GLP-1, before/after claims, health/guarantee language) opens a **held PR** for human review, always.

**Measure AI-search visibility without APIs.**
Real, warm browser profiles ask real questions across ChatGPT, Google AI Overviews, and Perplexity, geo-pinned per city, and log who gets cited, ranked, and linked — with full fan-out traces. Block-aware by design: a bot-walled engine is recorded as *blocked*, never as a fake zero. Includes a SERP radar (top-10 organic per city × money query, page-type fingerprinting) and a query-bank panel with variance decomposition (day vs spelling vs engine) so you know which movement is real.

**Decide with actual statistics.**
Two-proportion z-tests, Benjamini–Hochberg FDR across concurrent changes, difference-in-differences against control pages, locked evaluation horizons (no peeking), non-inferiority guardrails, and a keep/revert/try-next loop. Every rate ships with a confidence interval and a denominator — an `evidence-audit` command fails CI if any artifact contains a naked point estimate.

**Run itself.**
Weekly/daily routines (launchd on macOS, Task Scheduler on Windows), heartbeats, a three-tier human approvals queue (dashboard-ready JSON bundle + `--local` mode), Slack lanes (approval mirror with one-click deep links; a C-suite channel for big issues with 24h dedupe), and **zero-click client intake**: grant Search Console access to your agency Gmail and the engine onboards the site; invite its GitHub account to the site's repo and the PR lane wires itself (invitations accepted via API — it never clicks email links).

## What it refuses to do

These are load-bearing invariants, not settings:

- **PR-only writes.** No CMS direct-write path exists for auto-apply. WordPress live writes are refused by the experiment engine entirely.
- **YMYL/legal/money-page changes never auto-apply.** They queue for a human, every time, in every mode.
- **Fail-closed everywhere.** Unverifiable capture → `blocked`, not 0. Failed screenshot → human review, not auto-pass. Missing consensus → queued, not shipped.
- **No fabricated authority.** Bylines naming reviewers not in your config fail the gate. Unsourced statistics and prices are blocked.
- **Polite measurement.** Cooldown stamps persist across processes; circuit breakers halt on challenges; one IP is never hammered.

## Quickstart

```bash
git clone https://github.com/supahotthanos/seo-bot.git && cd seo-bot
npm install                                  # playwright/patchright for measurement (lazy — core runs without)

node bin/seo-bot.mjs setup yourdomain.com    # onboard: config + worksheet + citations + content plan
node bin/seo-bot.mjs connect yourdomain-com  # one-click Google OAuth (GSC/GA4) — see SETUP.md §1
node bin/seo-bot.mjs run yourdomain-com --apply   # full loop; fixes arrive as PRs for you to merge
node bin/seo-bot.mjs measure yourdomain-com  # AI-answer citations, no API
```

Drafting/verifying uses the **Claude Code CLI** if you're logged in (`claude`) — no API key — or set `ANTHROPIC_API_KEY`. Full runbooks: [QUICKSTART.md](QUICKSTART.md) (15-minute path) and [SETUP.md](SETUP.md) (OAuth, Slack lanes, intake, DNS).

## A few of the ~60 commands

| | |
|---|---|
| `audit` / `propose` / `apply --yes` | rule audit → EV-ranked fixes → PR |
| `weekly <client> --push` | the full autonomous cycle (cron target) |
| `blog-post <client>` | one gated, voice-calibrated post → PR |
| `blog-corpus <client>` | harvest ranking competitors' blogs → voice profile |
| `serp-radar <client>` | stealth top-10 per city × money queries + tactic fingerprints |
| `query-bank <client>` | ChatGPT answer panel with variance decomposition |
| `dashboard <client> --push` | publish the 3-tier approvals queue (+ Slack mirror) |
| `intake watch` | GSC grants / GitHub invites / mailbox → auto-onboard |
| `stats <client>` | significance verdicts on everything shipped |
| `doctor <client>` | what's missing, with the fix for each |

`node bin/seo-bot.mjs help` lists everything.

## Layout

```
bin/seo-bot.mjs      the CLI (every verb)
src/                 the engine — mostly pure functions + thin IO shells
src/stats/           z-tests, FDR, DiD, guardrails, decision loop
src/measure/         browsers, SERP radar, query bank, markets grid
src/content/         blog radar → drafts → gates → publish · voice engine
src/intake/          GSC / GitHub / mailbox client-intake lanes
test/                run.mjs (pure, no deps) + integration + no-cloud
store/               dashboard store contract (fs / GitHub / Postgres drivers)
```

Working on it with a coding agent? Read [AGENTS.md](AGENTS.md) first. The test suite is the contract: `npm test` must stay green.

## License

MIT — see [LICENSE](LICENSE).
