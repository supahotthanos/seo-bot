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

  // 2.5) dashboard: publish the (re)queued changes as 3-tier pending, and apply anything the
  //      founder approved in the dashboard since the last run (decisions pulled from the store).
  try {
    const { syncDashboard } = await import('./dashboard.mjs');
    await syncDashboard(cfg, { log, apply: push, confirm: push });
  } catch (e) { log(`  dashboard sync skipped: ${String(e.message || e).slice(0, 120)}`); }

  // 3) content/generate are intentionally NOT auto-published here (YMYL human gate) — the
  //    loop surfaces eligible drafts + generated pages for one-click review.

  // 4) weekly knowledge compile (GOAL C9: research → engine capability, worksheet stays ≤7 days
  //    fresh; human approves any proposed rule stubs — the compiler never writes rules itself)
  try {
    const { compileKnowledge } = await import('../scripts/compile-knowledge.mjs');
    await compileKnowledge({ log });
  } catch (e) { log(`  knowledge compile skipped: ${String(e.message || e).slice(0, 120)}`); }

  // 4.6) weekly query-bank PANEL slice (GOAL C4: accrue the multi-variant/multi-city AI-answer panel
  //      with CI bands + variance decomposition). Opt-in: only when a logged-in ChatGPT CDP endpoint is
  //      present (SEO_BOT_CDP_ENDPOINT). A small, resumable, circuit-broken, tier-major slice — the
  //      wrap-around cursor covers every city over successive weeks; ≥6 weekly runs = the artifact.
  //      Wrapped so it can never break the cycle; absent endpoint → silently skipped (safe default).
  if (process.env.SEO_BOT_CDP_ENDPOINT) {
    try {
      const { runQueryBank } = await import('./measure/query-bank-runner.mjs');
      const fs = await import('node:fs');
      const { join } = await import('node:path');
      const { ROOT } = await import('./config.mjs');
      const dir = join(ROOT, 'reports', 'query-bank', cfg.name);
      const tier = process.env.SEO_BOT_QB_TIER || 'low'; // tier-major: hold at low until cities covered, then bump
      const r = await runQueryBank(cfg, { overrides: { tiers: [tier] }, concurrency: Number(process.env.SEO_BOT_QB_CONCURRENCY) || 2, fs, dir, log });
      log(`  query-bank panel (${tier}): +${r.captured} captured · ${r.accrued} total observations · ${r.halted ? 'paused (cap/errors — resumes next week)' : 'ok'}`);
    } catch (e) { log(`  query-bank panel skipped: ${String(e.message || e).slice(0, 120)}`); }
  }

  // 4.65) CONTENT COHORT GUARDRAIL + DAILY BLOG POSTING (operator directive 2026-07-12).
  //       (a) Snapshot our published-post cohort's GSC share vs the whole site; a statistically
  //           significant collapse flips content-pause.flag (blog-publish then refuses until it
  //           clears — a scaled-content-abuse tripwire).
  //       (b) If not paused AND cms.repoPath is set AND a content-journey exists, publish the
  //           NEXT DUE post. Fully autonomous per the directive: draft → humanize → gates →
  //           auto-merged PR (YMYL still held). Never breaks the cycle on failure.
  try {
    const { runCohortGuardrail } = await import('./content/cohort-guardrail.mjs');
    const { pullGSC } = await import('./gsc.mjs');
    const fsC = await import('node:fs');
    const { join: joinC } = await import('node:path');
    const { ROOT: rC } = await import('./config.mjs');
    const dirC = joinC(rC, 'reports', cfg.name);
    const regPath = cfg.cms?.repoPath ? joinC(cfg.cms.repoPath, 'app/blog/posts.ts') : null;
    const gscForCohort = await pullGSC(cfg, { log: () => {} });
    const registrySource = regPath && fsC.existsSync(regPath) ? fsC.readFileSync(regPath, 'utf8') : '';
    let paused = false;
    if (gscForCohort.enabled && registrySource) {
      const cg = runCohortGuardrail(cfg, { gscPages: gscForCohort.pages, registrySource, fs: fsC, dir: dirC, log });
      paused = !!cg.flagged;
      // A tripped guardrail is exactly the "big issue" the C-suite channel exists for: our own
      // posts are statistically hurting the site and publishing has stopped itself.
      if (paused) {
        try {
          const { escalate } = await import('./escalate.mjs');
          await escalate(cfg, { severity: 'critical', area: 'content-guardrail', title: `Content cohort DECAYING — posting paused (${cfg.name})`, detail: 'The published-post cohort\'s GSC share collapsed vs baseline. blog-post refuses to publish until the data recovers (auto-clears). See reports/<client>/cohort-guardrail.json.' }, { log });
        } catch { /* escalation is a mirror, not a gate */ }
      }
    }
    // Auto-post if we have a live blog + a journey + no pause flag.
    const journeyPath = joinC(dirC, 'content-journey.json');
    if (push && !paused && cfg.cms?.repoPath && fsC.existsSync(journeyPath)) {
      const { nextDuePost, markPosted } = await import('./content/journey.mjs');
      const { publishBlogPost } = await import('./content/blog-publish.mjs');
      const { complete } = await import('./llm.mjs');
      const { execSync } = await import('node:child_process');
      const j = JSON.parse(fsC.readFileSync(journeyPath, 'utf8'));
      const due = nextDuePost(j, new Date().toISOString().slice(0, 10));
      if (due) {
        const pauseFlagPath = joinC(dirC, 'content-pause.flag');
        // Voice calibration from the winners' corpus, when blog-corpus has run.
        let voiceBlock = '';
        try { voiceBlock = JSON.parse(fsC.readFileSync(joinC(rC, 'research', 'blog-corpus', cfg.name, 'voice-profile.json'), 'utf8')).promptBlock || ''; } catch { /* no corpus yet */ }
        const r = await publishBlogPost(cfg, { brief: { topic: due.topic, questions: [due.aeoQuestion] }, deps: { fs: fsC, llm: complete, log, exec: async (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe' }).toString(), pauseFlagPath, voiceBlock, nowIso: new Date().toISOString() } });
        if (r.status === 'published' || r.status === 'pr-held-ymyl') {
          fsC.writeFileSync(journeyPath, JSON.stringify(markPosted(j, due.n, { slug: r.post?.slug || '', postedAt: new Date().toISOString() }), null, 2));
        }
        log(`  content-journey #${due.n} (${due.topic}): ${r.status}`);
      }
    }
  } catch (e) { log(`  content pipeline skipped: ${String(e.message || e).slice(0, 160)}`); }

  // 4.7) SELF-DRIVING EXPERIMENT LOOP (GOAL C8 + C5). Evaluate any ripe experiments at their locked
  //      horizon (the 3-lens verdict), then NOMINATE new POWER-GATED experiments from the latest
  //      proposals (which now carry per-page GSC impressions from the orchestrator join). The power
  //      gate refuses underpowered clusters — their fix ships the normal propose→apply way instead of
  //      burning a 28-day horizon on a guaranteed insufficient-data. Nominations register to
  //      experiments.ndjson (append-only, no-peek). Edge A/B splits are title/meta-class only
  //      (cloaking guard) and graduate via a SOURCE PR — never an auto-merge. Never breaks the cycle.
  try {
    const { selfDriveStep } = await import('./experiments/loop.mjs');
    const { loadLatestProposals } = await import('./apply/index.mjs');
    const data = loadLatestProposals(cfg);
    const proposals = (data && data.proposals) || [];
    const exp = await selfDriveStep(cfg, { proposals }, { log, confirm: push });
    log(`  experiments: ${exp.nominated} nominated · ${exp.candidateClusters} candidate cluster(s) · ${exp.evaluated} evaluated · ${exp.active} active`);
  } catch (e) { log(`  experiments loop skipped: ${String(e.message || e).slice(0, 120)}`); }

  // 5) weekly oversight brief
  const { dailyBrief } = await import('./brief.mjs');
  const brief = await dailyBrief(cfg, { log, hours: 24 * 7 });

  // 5.5) FOUNDER ACTION-PLAN weekly diff (founders+AI lane). Cheap signals only — the fresh
  //      site audit auto-verifies/reopens `site:*` tasks; local/citation tasks wait for the
  //      monthly deep-audit capture. A brand-new plan is NOT generated here (that's deep-audit's
  //      job) — this keeps an existing plan honest between deep runs. Never breaks the cycle.
  let planDiff = null;
  try {
    const fsAp = await import('node:fs');
    const { join: joinAp } = await import('node:path');
    const { ROOT: rAp } = await import('./config.mjs');
    if (fsAp.existsSync(joinAp(rAp, 'reports', cfg.name, 'deep-audit-latest.json'))) {
      const { runDeepAudit } = await import('./deep-audit.mjs');
      const { buildActionPlan } = await import('./action-plan.mjs');
      // capture:false = no live GBP/citation fetches on the weekly tick; site audit reuses the
      // loop's crawl budget (runAudit is cheap relative to the loop that just ran).
      const deep = await runDeepAudit(cfg, { log, capture: false, save: false });
      const plan = buildActionPlan(cfg, deep, { log });
      planDiff = { founderWeek: plan.founderWeek.length, verified: plan.autoVerified.verified.length, reopened: plan.autoVerified.reopened.length };
      // Slack: the founder's weekly checklist card (approvals channel — where the humans live).
      try {
        const { notifyFounderTodo } = await import('./notify.mjs');
        await notifyFounderTodo(cfg, plan, { log });
      } catch { /* the card is a mirror, not a gate */ }
    }
  } catch (e) { log(`  action-plan diff skipped: ${String(e.message || e).slice(0, 120)}`); }

  // 5.6) RANK LOOP Layer 2: weekly outcome snapshot (the longitudinal ledger nothing else
  //      keeps), the locked-horizon judgment sweep (fills decisions.ndjson — the previously
  //      DORMANT feed for auto-promotion + priors), and the scoreboard w/ stall detection.
  //      Each fail-soft; measurement honesty inside each module (null ≠ zero).
  let outcomes = null;
  try {
    const { snapshotOutcomes, scoreboard } = await import('./outcomes.mjs');
    const { horizonSweep } = await import('./stats/horizon-sweep.mjs');
    const snap = await snapshotOutcomes(cfg, { log });
    const sweep = await horizonSweep(cfg, { log });
    if (sweep.note) log(`  horizon-sweep: ${sweep.note}`);
    const sb = await scoreboard(cfg, { log });
    outcomes = { snapshot: snap.appended, swept: sweep.swept, booked: sweep.booked, stalled: !!sb.stalled };
  } catch (e) { log(`  outcomes skipped: ${String(e.message || e).slice(0, 120)}`); }

  // 5.7) RANK LOOP Layer 3: the bet cycle — score every active bet past its locked horizon
  //      against the outcomes ledger (hit/miss/inconclusive, honest grace window), place any
  //      bets today's strategist memo proposed for this client, and mirror new proposals to
  //      Slack for the human verdict. The agent's record compounds in bets-brief.md, which
  //      next morning's strategist READS — memory closes the loop. Never breaks the cycle.
  let betCycle = null;
  try {
    const { runBetCycle } = await import('./bets.mjs');
    const bc = await runBetCycle(cfg, { log });
    betCycle = { scored: bc.scoredNow.length, placed: bc.placed.length, hitRate: bc.record.hitRate };
    if (bc.placed.length) {
      try { const { notifyBetProposals } = await import('./notify.mjs'); await notifyBetProposals(cfg, { placed: bc.placed, record: bc.record }, { log }); }
      catch { /* the ledger is the record; Slack is a mirror */ }
    }
  } catch (e) { log(`  bet cycle skipped: ${String(e.message || e).slice(0, 120)}`); }

  const summary = { client: cfg.name, started, finished: nowIso(), auditScore: loop.auditScore, pushed: auto.applied, queued: (auto.policyQueued || 0) + (auto.verifierRejected || 0), flagged: brief.flagged?.length || 0, planDiff, outcomes, betCycle };
  log(`\n✓ Weekly routine complete — audit ${loop.auditScore}/100 · ${auto.applied} auto-applied (consensus) · ${summary.queued} queued · ${summary.flagged} flagged in the brief\n`);
  return summary;
}
