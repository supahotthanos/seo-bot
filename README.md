# seo-bot

**An autonomous, plug-and-play SEO/AEO engine.** It audits a site, proposes on-page fixes,
pushes them as **pull requests behind a verifier-consensus gate**, and measures how the brand
shows up in **AI answer engines** (ChatGPT, Google AI Mode, Perplexity, AI Overviews) the way
real users see them — no paid rank-tracker, no marketing-API.

It’s built to run on the **[Claude Code](https://claude.com/claude-code) subscription with no API
key** (it shells out to the `claude` CLI), or on the Anthropic API if you prefer. Every model
call — fix rewrites, content drafts, and the adversarial reviewer panel — goes through one
provider abstraction.

> Built for, and designed to be driven by, a dev team that uses Claude Code. Start with
> **[seo-bot/HANDOFF.md](seo-bot/HANDOFF.md)** — the one-page operator guide.

## Why it exists
Classic SEO tools optimize for Google’s ten blue links. AEO/GEO is a different game: AI answers
are **probabilistic**, location- and session-conditioned, and drawn from a citation layer that
overlaps less and less with the organic top-10. seo-bot treats the two as separate clocks —
publish weekly, judge on lag — and measures the AI surfaces directly by driving the real consumer
apps with a stealth browser, not an API that shows something your customers never see.

## What makes it safe to point at a live site
This is the part most “auto-SEO” tools get wrong. seo-bot’s design rule is **no silent failures
and no unsafe autonomy**:

- **Verifier consensus** — before *anything* auto-pushes, an independent panel of ≥3 adversarial
  model reviewers must **unanimously** agree it’s safe. Fail-closed: no model available → queued
  for a human.
- **PR/diff only** — the autopilot pushes through Next.js PRs / edge-overlay diffs. It will
  **never** do a live overwrite (e.g. WordPress REST is excluded from the auto path).
- **Hard human gates that never relax** — fake/incentivized reviews, YMYL/medical claims, money
  pages (home/pricing/book/consult), and irreversible actions (301/redirect/noindex/disavow).
- **Change-ledger + one-click rollback** — every write is journaled with its before-value
  (Next.js via the PR; edge via a re-PATCH of the prior overlay).
- **Block-aware measurement** — a bot-challenge/consent page is recorded as `blocked` and
  **excluded** from visibility stats, so detection can never masquerade as a real “not mentioned”.

It was hardened by an adversarial multi-agent code review (49 agents) — see
**[research/ultrareview-seo-bot-2026-06.md](research/ultrareview-seo-bot-2026-06.md)**.

## Quick start
```bash
npm install                                   # cheerio (core). Browser/LLM deps are optional.
node seo-bot/bin/seo-bot.mjs help             # every command
node seo-bot/bin/seo-bot.mjs test             # the test suite (must stay green)

cp seo-bot/config/example.client.json seo-bot/config/myclient.json   # configure a site
node seo-bot/bin/seo-bot.mjs audit myclient   # crawl + score, write a report
```

For AI-visibility tracking (browser automation), on the machine that will run it:
```bash
npm i patchright && npx patchright install chromium   # stealth driver (falls back to playwright)
node seo-bot/bin/seo-bot.mjs discover myclient --write # build THIS client's own prompt panel
node seo-bot/bin/seo-bot.mjs measure  myclient         # capture answers + cited sources per engine
node seo-bot/bin/seo-bot.mjs sources  myclient         # → what AI cites most + off-site worklist
```

## What’s in here
- **`seo-bot/`** — the engine (~116 ES modules): audit/diagnose, page generation, the autopilot
  + verifier consensus, apply adapters (Next.js / edge / Cloudflare Worker), migration, briefs,
  the Claude Code provider, and the Python Scrapling stealth sidecar.
- **`scripts/ai-visibility/`** — the no-API AI-visibility tracker (ChatGPT / AI Mode / AIO /
  Perplexity / organic) via Patchright/Camoufox.
- **`research/`** — the SEO/AEO playbooks behind the engine: master playbook, AI-observation /
  stealth study, pioneer tactics, automation landscape, and the competitive teardown that shaped
  the design.

## Docs
| Read this | For |
|---|---|
| [seo-bot/HANDOFF.md](seo-bot/HANDOFF.md) | the one-page operator guide (commands, autopilot, migration, go-live) |
| [seo-bot/SETUP.md](seo-bot/SETUP.md) | first-run setup |
| [seo-bot/routine/WEEKLY-CRON.md](seo-bot/routine/WEEKLY-CRON.md) | the weekly autonomous cron |
| [research/ai-observation-stealth-2026.md](research/ai-observation-stealth-2026.md) | what publicly drives ChatGPT/Google + non-interference protocol |
| [AGENTS.md](AGENTS.md) | working in this repo with Claude Code (the safety invariants) |

## Ground rules (don’t weaken these)
The legal/YMYL/irreversible gates and the verifier consensus are **fail-closed by design**. If
you touch the apply or policy layer, keep `node seo-bot/bin/seo-bot.mjs test` green and never let
a failure path report success. Scraping/browser-automation should run from a **residential IP**
(never a datacenter range) and at modest volume — it’s a measurement tool for **your own** brand.

## License
MIT — see [LICENSE](LICENSE).
