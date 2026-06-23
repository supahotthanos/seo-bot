// seo-bot · routine — the autonomous WEEKLY cycle, designed to be a cron target. One call:
//   1) read loop (pull GSC/GA4 → audit → propose → verify-render → indexnow → measure AI
//      visibility → off-site sources) — writes nothing to prod.
//   2) autopilot — policy + VERIFIER CONSENSUS → push only the safe, statistically-proven
//      class via a PR adapter (or queue everything if no model / no consensus).
//   3) brief — the weekly oversight digest of what changed + flags + rollback pointers.
// "Only act on statistically significant data" is already enforced inside the autopilot's
// policy gate (changeClassProven reads the stats decisions ledger; nothing with a prior
// revert auto-applies). Runs on the Claude Code subscription via src/llm.mjs — no API key.

import { nowIso } from './util.mjs';

export async function weeklyRoutine(cfg, { log = () => {}, push = false, n = 3 } = {}) {
  const started = nowIso();
  log(`\n▶ WEEKLY ROUTINE · ${cfg.brand} (${cfg.baseUrl}) · ${push ? 'autopilot=PUSH' : 'autopilot=plan'}\n`);

  // 1) read loop — audit + measure + propose + stats (no writes)
  const { runLoop } = await import('./orchestrator.mjs');
  const loop = await runLoop(cfg, { log, apply: false });

  // 2) autopilot — consensus-gated apply (only the proven-safe class)
  const { runAutopilot } = await import('./autopilot.mjs');
  const auto = await runAutopilot(cfg, { log, push, n });

  // 3) content/generate are intentionally NOT auto-published here (YMYL human gate) — the
  //    loop surfaces eligible drafts + generated pages for one-click review.

  // 4) weekly oversight brief
  const { dailyBrief } = await import('./brief.mjs');
  const brief = await dailyBrief(cfg, { log, hours: 24 * 7 });

  const summary = { client: cfg.name, started, finished: nowIso(), auditScore: loop.auditScore, pushed: auto.applied, queued: (auto.policyQueued || 0) + (auto.verifierRejected || 0), flagged: brief.flagged?.length || 0 };
  log(`\n✓ Weekly routine complete — audit ${loop.auditScore}/100 · ${auto.applied} auto-applied (consensus) · ${summary.queued} queued · ${summary.flagged} flagged in the brief\n`);
  return summary;
}
