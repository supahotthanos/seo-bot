# Working in this repo (for Claude Code / coding agents)

This is **seo-bot** — an autonomous SEO/AEO engine. Read this before changing code.

## Layout
- `seo-bot/src/` — the engine (ES modules, mostly pure functions + thin IO shells).
- `seo-bot/bin/seo-bot.mjs` — the CLI dispatcher (every command).
- `seo-bot/test/run.mjs` + `integration.mjs` — the test suite (`npm test`). Pure-function unit
  tests + an integration loop. **Must stay green before any merge.**
- `seo-bot/scraper/fetch.py` — the Python Scrapling/Camoufox stealth sidecar.
- `scripts/ai-visibility/track.mjs` — the browser AI-visibility tracker.
- `research/` — the SEO/AEO knowledge base the engine encodes.

Paths are resolved from a `ROOT` constant (`seo-bot/src/config.mjs`) = the repo root. Keep the
`seo-bot/` + `scripts/` directory layout; modules read `ROOT/scripts/ai-visibility/…`,
`ROOT/seo-bot/reports/…`, and an optional `ROOT/data/all-spas.json` dataset.

## The invariants — do NOT weaken these
This bot is allowed near live client sites *only* because of these. Treat any change that
loosens one as a breaking change requiring tests + explicit review:

1. **Fail-closed, never fail-open.** No path may report success, “no data”, or “safe” when an
   operation actually failed. Blocked scrapes are `status: blocked` and excluded from stats; an
   unparseable LLM/verifier reply is `null`/UNSAFE, not a pass.
2. **Autopilot pushes via PR/diff adapters only** (`PR_ADAPTERS` in `src/autopilot.mjs`) — never
   a live overwrite (WordPress is intentionally excluded).
3. **Verifier consensus is unanimous + floored at 3 reviewers + gated on an available model.**
   No model → queue for a human.
4. **Hard human gates** (`src/policy.mjs`): legal/YMYL/GLP-1, money paths
   (home/pricing/book/consult), severity ceiling, irreversible actions. A malformed config regex
   fails **closed** (blocks), never open.
5. **Every write is journaled** to the change-ledger with a before-value (`src/change-ledger.mjs`)
   so it can be rolled back.

## How to run / verify
```bash
npm install            # cheerio; browser + LLM deps are optional
npm test               # the suite — keep it green
node seo-bot/bin/seo-bot.mjs help
```
Model calls go through `src/llm.mjs` — by default the `claude` CLI (Claude Code subscription, no
API key). Be logged into `claude` in whatever shell runs the autopilot/cron, or set
`ANTHROPIC_API_KEY` for the API fallback.

## When you add code
- Match the surrounding style: small pure functions, defensive parsing, a unit test per pure
  function in `test/run.mjs`.
- If you add a measurement or apply path, add the block-aware / fail-closed handling and a test
  that proves the failure mode is handled — a green suite that skips the safety-critical path is
  itself a regression.
