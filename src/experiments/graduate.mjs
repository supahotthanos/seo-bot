// seo-bot · experiments/graduate — turn a WINNING experiment into a SOURCE PR.
//
// The self-driving loop (experiments/loop.mjs) promotes an experiment when all three lenses
// agree; this module executes that promotion: it opens a PR against the client's source repo
// (via the existing apply/nextjs.mjs PR path) whose body is the full EVIDENCE BUNDLE
// (experiments/evidence.mjs) — three-lens verdict, effect sizes + CIs, locked-horizon dates,
// FNV-1a bucketing note, exact variant diff, rollback plan. The human reviews and merges.
//
// HARD GATES (invariants — do not weaken):
//   • confirm/--yes required. Without it this is a pure preview: no git, no PR, no writes.
//   • PR/diff adapters ONLY — PR_ADAPTERS is imported from autopilot.mjs (single source of
//     truth). wordpress (live overwrite) is REFUSED outright; unknown adapters fail closed.
//   • NEVER merges. `gh pr create` opens the PR; merging stays human, always.
//   • every executed write is journaled to the change-ledger (rollback pointer).

import { currentExperiments, setStatus as setExpStatus } from './registry.mjs';
import { buildEvidenceBundle } from './evidence.mjs';
import { PR_ADAPTERS } from '../autopilot.mjs';

/** The 'promoted' status-history event (its `at` is the single horizon evaluation record). */
function promotedAt(exp) {
  const h = Array.isArray(exp.history) ? exp.history : [];
  for (let i = h.length - 1; i >= 0; i--) if (h[i]?.status === 'promoted') return h[i].at || null;
  return null;
}

/**
 * Graduate every experiment with status 'promoted' (and not yet graduated) into a source PR.
 *
 * @param {object} cfg  client config (cfg.name, cfg.cms.type, cfg.edge?.key)
 * @param {{log?:Function, confirm?:boolean, nowMs?:number}} opts
 * @returns {Promise<{graduated:Array, refused:Array, preview:Array, dryrun:boolean}>}
 */
export async function graduatePromoted(cfg, { log = () => {}, confirm = false, nowMs = Date.now() } = {}) {
  const client = cfg?.name;
  const adapter = cfg?.cms?.type || 'dryrun';
  const out = { graduated: [], refused: [], preview: [], dryrun: !confirm };

  const promoted = currentExperiments(client).filter((e) => e.status === 'promoted' && !e.graduatedAt);
  if (!promoted.length) { log('  no promoted experiments awaiting graduation.'); return out; }

  // HARD GATE — adapter. wordpress is a live overwrite (no PR, no diff) → refuse outright;
  // anything not in PR_ADAPTERS is unknown → fail closed. Checked BEFORE any adapter import.
  if (adapter === 'wordpress') {
    for (const e of promoted) out.refused.push({ experimentId: e.id, reason: 'wordpress is a live-overwrite adapter — graduation opens source PRs only (PR_ADAPTERS in src/autopilot.mjs); refusing (fail-closed).' });
    log(`  ⛔ refusing to graduate ${promoted.length} experiment(s): cms.type=wordpress has no PR/diff path. Point cfg.cms at the source repo (nextjs) instead.`);
    return out;
  }
  if (!PR_ADAPTERS.has(adapter)) {
    for (const e of promoted) out.refused.push({ experimentId: e.id, reason: `cms.type "${adapter}" is not a PR/diff adapter (${[...PR_ADAPTERS].join('/')}) — refusing (fail-closed).` });
    log(`  ⛔ refusing to graduate ${promoted.length} experiment(s): cms.type "${adapter}" is not in PR_ADAPTERS.`);
    return out;
  }

  // Recover the original winning proposals (exact diff + any patch payloads), best-effort.
  let latest = null;
  try { const { loadLatestProposals } = await import('../apply/index.mjs'); latest = loadLatestProposals(cfg); } catch { /* bundle stays honest about a missing diff */ }

  const items = promoted.map((exp) => {
    const ids = new Set(exp.proposalIds || []);
    const variantSet = new Set(exp.variantPages || []);
    const winning = (latest?.proposals || []).filter((p) => ids.has(p.id) && (!p.page || variantSet.size === 0 || variantSet.has(p.page) || variantSet.has(p.url)));
    const evaluatedAt = exp.evaluatedAt || promotedAt(exp);
    const bundle = buildEvidenceBundle(exp, { action: 'promote', reason: exp.decisionReason || 'all three lenses agreed at the locked horizon.', lenses: exp.lenses || null }, { proposals: winning.length ? winning : null, evaluatedAt, client, edgeKey: cfg.edge?.key || 'seoOverlay' });
    const prTitle = `seo-bot: graduate experiment ${exp.id} (${exp.variantField} on ${exp.template})`;
    return { exp, winning, bundle, prTitle };
  });

  // HARD GATE — confirm. Preview never touches git/gh/fs.
  if (!confirm) {
    for (const it of items) {
      out.preview.push({ experimentId: it.exp.id, template: it.exp.template, variantField: it.exp.variantField, prTitle: it.prTitle, proposalCount: it.winning.length, bundleChars: it.bundle.length });
      log(`  ⚗ would graduate ${it.exp.id} · ${it.exp.template} (${it.exp.variantField}) — PR "${it.prTitle}" with a ${it.bundle.length}-char evidence bundle body.`);
    }
    log('  (preview — re-run with --yes to open the source PR(s). Nothing ever merges automatically.)');
    return out;
  }

  const { applyNextjs } = await import('../apply/nextjs.mjs');
  for (const it of items) {
    const exp = it.exp;
    // The PR always carries the evidence bundle as a committed review doc, plus any original
    // patch/fileWrite payloads that bake the winning variant into source (apply/nextjs.mjs
    // treats non-patch proposals as advisory — the doc is the reviewable artifact either way).
    const docWrite = { id: `grad-${exp.id}`, type: 'experiment.graduation-evidence', page: exp.template, fileWrite: { path: `docs/seo-bot/graduations/${exp.id}.md`, content: it.bundle } };
    const data = { client, brand: cfg.brand, proposals: [...it.winning, docWrite], ranAt: new Date(nowMs).toISOString(), score: '-', prTitle: it.prTitle, prBody: it.bundle };
    try {
      const res = await applyNextjs(cfg, data, { log, confirm: true }); // opens branch + PR; NEVER merges
      if (res?.dryrun || !res?.applied?.length) {
        out.refused.push({ experimentId: exp.id, reason: 'PR adapter applied nothing (no git repo / payloads did not apply cleanly) — experiment left promoted for a human.' });
        continue;
      }
      try { const { recordChanges } = await import('../change-ledger.mjs'); recordChanges(client, res.applied, { adapter: 'nextjs', runId: `graduate-${exp.id}` }); } catch { /* ledger is best-effort */ }
      try { setExpStatus(client, exp.id, 'promoted', { nowMs, extra: { graduatedAt: new Date(nowMs).toISOString(), graduationPr: res.pr || null, graduationBranch: res.branch || null } }); } catch (e) { log(`  ! could not record graduation on ${exp.id}: ${e.message}`); }
      out.graduated.push({ experimentId: exp.id, pr: res.pr || null, branch: res.branch || null, files: res.applied.length });
      log(`  🏆 graduated ${exp.id} → ${res.pr || `branch ${res.branch} (no PR — push + open manually)`}`);
    } catch (e) {
      out.refused.push({ experimentId: exp.id, reason: `PR path failed: ${String(e.message || e).slice(0, 200)} — no state change recorded (fail-closed).` });
      log(`  ✗ graduation failed for ${exp.id}: ${String(e.message || e).slice(0, 160)}`);
    }
  }
  return out;
}
