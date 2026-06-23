# seo-bot — ultrareview (2026-06-23)

Multi-agent adversarial review of **seo-bot only** (`seo-bot/` + `scripts/ai-visibility/`; the No
BS site was out of scope). 9 review lenses → per-finding adversarial verification → synthesis.
**49 agents · 39 findings confirmed · 0 rejected on verification.**

## Verdict
The **read-only / advisory** surface (audit, measure, sources, briefs, generate-to-review,
migration configs) is largely sound. The **autonomous `--push` path is NOT yet safe to enable
unattended** — it has cross-run data loss (edge overlay), broken rollback for edge/worker, a
`git add -A` that sweeps stray files into the auto-PR, and the push safety-gate has no test. Also,
several **measurement metrics were being reported falsely** (now fixed). 
→ **Safe today:** run in plan/PR-review mode (`autopilot` without `--push`, human merges).
→ **Before `--push`:** land the 5 open must-fixes below.

## Round 1 — FIXED (committed, +3 regression tests, 120 passing)
Data integrity (the bot was reporting false numbers — several were regressions from the AI-tracker work):
- ✅ `track.mjs` **visibility_pct denominator** excluded genuinely-absent answers → inflated the headline metric (1/10 → reported 1/2). Now `answered+absent`, excludes only `blocked`.
- ✅ `track.mjs` **uuleFor** produced an *invalid* uule (raw char code) → geo-pin silently did nothing. Fixed to `w+CAIQICI`+SECRET[len%64]+b64.
- ✅ `pages.mjs` **dedupeSpas** keyed on name+address+**phone** → **452 duplicate spas** leaked onto listicles (verified exactly 452 on the real dataset). Now name+address only.
- ✅ `track.mjs` **google_organic** aggregated like an answer-engine (rank #1 → "visibility 0"); now reports true organic position.
- ✅ `brief.mjs` could attribute the global single-brand AI capture to the **wrong client**; now gated on brand/domain match.

Fail-closed hardening:
- ✅ `autopilot.tallyConsensus` threshold ≤0 could pass with **zero safe votes** → clamp ≥1 + require safeCount ≥1. `verifierConsensus` floored to **3 reviewers** (n=1 can't auto-push solo).
- ✅ `policy.mjs` malformed `highRiskPathRe` silently **disabled** the high-risk-path blocker → now fail-closed (blocks).
- ✅ `llm.mjs` non-JSON CLI stdout was returned as a *successful* completion → now `null`.
- ✅ `pages.mjs` hardcoded `hasUniqueData:true` defeated the thin-page gate (now earned); dataset `JSON.parse` wrapped (corrupt = graceful skip, not a mid-batch crash).
- ✅ `measure.mjs` `execFileSync` had **no timeout** → a hung browser could freeze the weekly cron forever. Added a 20-min SIGKILL watchdog + passes `cfg.location` for the uule pin.
- ✅ `track.mjs` per-prompt `context.close` moved into `finally` (a wedged close no longer aborts the run).
- ✅ `discover.mjs` guards a missing brand (no more "undefined reviews").

## Round 2 — OPEN must-fix (gate before enabling `--push`)
1. **`apply/edge.mjs:124-136`** — autopilot edge PATCH replaces the *whole* overlay key, dropping all prior path overrides → **cross-run data loss**. `loadPriorOverlay` is read but never merged. *Fix:* GET live key + deep-merge per path before PATCH.
2. **`scraper/fetch.py:188-196`** — stealth sidecar returns `ok` on Cloudflare/consent/CAPTCHA pages → `serp.mjs`/`geogrid.mjs` persist blocked scrapes as real "not ranking". *Fix:* treat 403/429/503 or a challenge body as `ok:false`; exclude from denominators (port `detectBlocked` here).
3. **`change-ledger.mjs:21`** — edge/worker live writes journaled as non-reversible → **rollback broken** (only WordPress restores). *Fix:* capture prior overlay per path; add an edge/worker rollback branch; fail loud, don't mark non-reversible silently.
4. **`apply/nextjs.mjs:70`** — autopilot push uses `git add -A` → sweeps every untracked file (≈30 in the repo root) into the verifier-gated PR; no `try/finally` restores the base branch on throw. *Fix:* stage only `changedFiles`; clean-tree precheck; `try/finally` back to base branch.
5. **`test/run.mjs`** — the #1 invariant (consensus-safe, PR-only, never live WordPress) is **untested**. *Fix:* tests for no-LLM→fail-closed, unparseable verdict→unsafe, push refused when `cms.type==='wordpress'`.

## Round 3 — OPEN should-fix
- `content/index.mjs:137-156` — YMYL publish opens the PR before the compliance re-gate runs.
- `sources/index.mjs:56` + `sov.mjs:27` + `work-order.mjs:58` — block-aware denominator not applied (centralize the predicate).
- `routine.mjs:13` — core-update freeze not wired into the autopilot push path.
- `migrate.mjs:96` — low-confidence "review" matches written as permanent 301s (emit commented / 302 until confirmed).
- `apply/edge.mjs:137-140` — edge PATCH failure still reports applied/pushed.
- `connect/logs.mjs:109` — log-drain ingest fetch has no timeout.
- `track.mjs:105-109` — mentionCount double-counts overlapping brand aliases.
- `config.mjs:106` — `loadConfig` with a full json path derives `cfg.name` with slashes (latent).
- `decide.mjs:55` — defense-in-depth note on LLM-rewritten page text → PR value (no change required given existing gates).

_Coverage gap: this was a static review; live scrape/push behaviors are confirmable only on the Mac Mini._
