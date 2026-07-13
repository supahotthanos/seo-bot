// seo-bot · experiments/evidence — the PR-body evidence bundle for a graduating experiment.
//
// A promoted experiment ships to a SOURCE PR with the complete statistical case attached, so
// the human merging it can audit every claim without opening the bot's internals:
//   • the three-lens verdict — controller (z/DiD + BH-FDR flag), counterfactual causal CI,
//     guardrails (non-inferiority + SRM)
//   • effect sizes WITH confidence intervals (a lift without a CI is a vibe, not evidence)
//   • the locked-horizon dates — registered vs evaluated — proving the no-peeking discipline
//     (peeking inflates false positives from 5% to 30-40%; see experiments/registry.mjs)
//   • the bucketing method — deterministic FNV-1a per PAGE, identical for bots and humans
//     (the line between an experiment and cloaking)
//   • the exact variant diff and the rollback plan (change-ledger pointer)
//
// COVERAGE HONESTY (fail-closed reporting): a lens that did not run renders as an explicit
// "MISSING" section plus a bundle-level incompleteness warning. An absent check must NEVER
// read as a passing one — silence is how bad promotions sneak past reviewers.

const num = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const yesNo = (v) => (v === true ? 'yes' : v === false ? 'no' : 'unknown');
const code = (v) => '`' + String(v ?? 'n/a') + '`';

/** Which of the three lenses actually produced a verdict. Pure; used by tests + graduate. */
export function lensCoverage(verdicts) {
  const lenses = verdicts?.lenses || verdicts || {};
  return {
    controller: !!(lenses.controller && typeof lenses.controller.decision === 'string'),
    counterfactual: lenses.counterfactual?.ok === true, // ran AND fit — a failed-closed fit is not coverage
    guardrails: !!(lenses.guardrails && typeof lenses.guardrails.decision === 'string'),
  };
}

const MISSING = (name, detail) =>
  `> ❌ **MISSING — the ${name} lens was NOT evaluated for this experiment.** ${detail}\n` +
  `> Do NOT treat this section as passing; the absence of a check is not evidence of safety.`;

/**
 * Build the markdown PR body for one experiment + its fused evaluation verdicts.
 *
 * @param {object} experiment  registry record: { id, template, hypothesis, variantField,
 *   controlPages[], variantPages[], at, lockedHorizonDate, horizonDays, proposalIds[], ... }
 * @param {object} verdicts    an evaluate() decision ({ action, reason, lenses:{controller,
 *   counterfactual, guardrails} }) or a bare { controller, counterfactual, guardrails } map.
 * @param {object} [opts]
 * @param {Array}  [opts.proposals]    the original winning proposals (for the exact diff)
 * @param {string} [opts.evaluatedAt]  ISO timestamp of the (single) horizon evaluation
 * @param {string} [opts.client]       client slug for ledger paths
 * @param {string} [opts.edgeKey]      Edge Config key holding the variant overlay
 * @returns {string} markdown
 */
export function buildEvidenceBundle(experiment = {}, verdicts = {}, { proposals = null, evaluatedAt = null, client = null, edgeKey = 'seoOverlay' } = {}) {
  const exp = experiment || {};
  const lenses = verdicts?.lenses || verdicts || {};
  const cov = lensCoverage(verdicts);
  const missing = ['controller', 'counterfactual', 'guardrails'].filter((k) => !cov[k]);
  const slug = client || exp.client || '<client>';
  const L = [];

  // ── header ──
  L.push(`# Evidence bundle — experiment ${code(exp.id)}`);
  L.push('');
  L.push(`**Template:** ${code(exp.template)} · **Variant field:** ${code(exp.variantField)} · **Client:** ${code(slug)}`);
  if (exp.hypothesis) L.push(`**Hypothesis:** ${exp.hypothesis}`);
  if (verdicts?.action || verdicts?.reason) L.push(`**Fused verdict:** ${String(verdicts.action || '').toUpperCase() || 'n/a'} — ${verdicts.reason || 'no fused reason recorded'}`);
  L.push('');

  // ── coverage honesty (up front, before any numbers) ──
  L.push(`## Lens coverage`);
  L.push(`| Lens | Ran |`);
  L.push(`|---|---|`);
  L.push(`| 1 · Controller (z/DiD + BH-FDR) | ${cov.controller ? '✅ yes' : '❌ MISSING'} |`);
  L.push(`| 2 · Counterfactual causal impact | ${cov.counterfactual ? '✅ yes' : '❌ MISSING'} |`);
  L.push(`| 3 · Guardrails (non-inferiority + SRM) | ${cov.guardrails ? '✅ yes' : '❌ MISSING'} |`);
  if (missing.length) {
    L.push('');
    L.push(`> ⚠️ **INCOMPLETE EVIDENCE: ${missing.length} of 3 lenses missing (${missing.join(', ')}).** This bundle must NOT be read as a full three-lens pass — the missing lens(es) were never run, which is not the same as passing. Hold the merge until they run, or accept the gap explicitly.`);
  }
  L.push('');

  // ── lens 1: controller ──
  L.push(`## Lens 1 — controller (z/DiD vs matched control + BH-FDR)`);
  if (cov.controller) {
    const c = lenses.controller;
    L.push(`- decision: ${code(c.decision)}`);
    L.push(`- p-value: ${code(num(c.pValue, 4))} · passed BH-FDR across the batch: **${yesNo(c.passedFDR)}**`);
    if (c.reason) L.push(`- reason: ${c.reason}`);
  } else {
    L.push(MISSING('controller', 'No z/DiD verdict or BH-FDR flag exists for this experiment.'));
  }
  L.push('');

  // ── lens 2: counterfactual ──
  L.push(`## Lens 2 — counterfactual causal impact (control-as-predictor)`);
  if (cov.counterfactual) {
    const cf = lenses.counterfactual;
    const ci = Array.isArray(cf.ci) && cf.ci.length === 2 ? cf.ci : null;
    const excludesZero = ci ? (ci[0] > 0 || ci[1] < 0) : null;
    L.push(`- cumulative lift: **${num(cf.cumulativeLift, 1)}** (95% CI ${ci ? `[${num(ci[0], 1)}, ${num(ci[1], 1)}]` : 'n/a'}) — CI excludes 0: **${yesNo(excludesZero)}**`);
    L.push(`- p-value: ${code(num(cf.pValue, 4))} · direction: ${code(cf.direction)} · significant: **${yesNo(cf.significant === true)}**`);
  } else if (lenses.counterfactual && lenses.counterfactual.ok === false) {
    L.push(`> ❌ **RAN BUT FAILED CLOSED — no causal CI was produced.** ${lenses.counterfactual.reason || 'The model could not be fit (short/corrupt baseline).'}\n> Do NOT treat this section as passing.`);
  } else {
    L.push(MISSING('counterfactual', 'No daily control/variant series was available, so no causal cumulative-lift CI exists.'));
  }
  L.push('');

  // ── lens 3: guardrails ──
  L.push(`## Lens 3 — guardrails (non-inferiority + SRM)`);
  if (cov.guardrails) {
    const g = lenses.guardrails;
    const breaches = Array.isArray(g.breaches) ? g.breaches : [];
    L.push(`- decision: ${code(g.decision)}`);
    L.push(`- breaches: ${breaches.length ? breaches.map((b) => code(b)).join('; ') : 'none'}`);
    L.push(`- SRM (sample-ratio mismatch): **${g.srm === true ? 'YES — split broken, experiment invalid' : g.srm === false ? 'no — split healthy' : 'not checked'}**`);
  } else {
    L.push(MISSING('guardrails', 'No non-inferiority / SRM verdict exists — conversion, clicks, CWV and citation safety were never certified.'));
  }
  L.push('');

  // ── effect sizes with CIs ──
  L.push(`## Effect sizes (with confidence intervals)`);
  const eff = [];
  if (cov.counterfactual) {
    const cf = lenses.counterfactual;
    const ci = Array.isArray(cf.ci) && cf.ci.length === 2 ? cf.ci : null;
    eff.push(`- causal cumulative lift: **${num(cf.cumulativeLift, 1)}** ${ci ? `(95% CI [${num(ci[0], 1)}, ${num(ci[1], 1)}])` : '(no CI)'}`);
  }
  if (cov.controller) eff.push(`- controller p-value: ${num(lenses.controller.pValue, 4)} (BH-FDR ${lenses.controller.passedFDR ? 'passed' : 'NOT passed'})`);
  if (eff.length) L.push(...eff);
  else L.push(`> ❌ No effect size with a CI is available — neither lens that produces one ran. Do not merge on anecdote.`);
  L.push('');

  // ── locked horizon: no peeking ──
  L.push(`## Locked horizon — proof of no peeking`);
  L.push(`- registered: ${code(exp.at || 'unknown')} (status ${code((exp.history && exp.history[0]?.status) || 'nominated')})`);
  L.push(`- locked horizon date (pre-registered at nomination): ${code(exp.lockedHorizonDate || 'unknown')}${exp.horizonDays ? ` (${exp.horizonDays} days)` : ''}`);
  if (evaluatedAt) {
    const peeked = exp.lockedHorizonDate && Date.parse(evaluatedAt) < Date.parse(exp.lockedHorizonDate);
    L.push(`- evaluated: ${code(evaluatedAt)} — ${peeked ? '⚠️ **BEFORE the locked horizon — this evaluation peeked and its p-values are inflated; do not merge on it.**' : 'at/after the locked horizon; the experiment was judged ONCE, at horizon (no interim peeks).'}`);
  } else {
    L.push(`- evaluated: **not recorded** — this bundle cannot prove the no-peek discipline on its own; check reports/${slug}/experiments.ndjson status history before merging.`);
  }
  L.push('');

  // ── bucketing method ──
  L.push(`## Bucketing method — deterministic, not cloaking`);
  L.push(`Assignment is a deterministic **FNV-1a** 32-bit hash of \`experimentId::path\` — per **PAGE**, never per user/cookie/user-agent (experiments/registry.mjs \`hashPath\`/\`assignArm\`). Every visitor — Googlebot included — receives the one identical rendering of each URL. That determinism is the line between an experiment and cloaking, and the edge cloaking-guard additionally refuses any non-head field.`);
  const cp = Array.isArray(exp.controlPages) ? exp.controlPages : [];
  const vp = Array.isArray(exp.variantPages) ? exp.variantPages : [];
  L.push(`- control pages (${cp.length}): ${cp.map(code).join(', ') || 'unknown'}`);
  L.push(`- variant pages (${vp.length}): ${vp.map(code).join(', ') || 'unknown'}`);
  L.push('');

  // ── exact variant diff ──
  L.push(`## Exact variant diff`);
  if (Array.isArray(proposals) && proposals.length) {
    for (const p of proposals) {
      L.push(`### ${code(p.page || p.url || '?')} · ${code(p.type || '?')}`);
      L.push('```diff');
      L.push(`- ${String(p.current ?? '(unset)')}`);
      L.push(`+ ${String(p.proposed ?? '(unset)')}`);
      L.push('```');
    }
  } else {
    L.push(`> ❌ variant diff unavailable — the original proposals were not supplied to this bundle. See reports/${slug}/proposals-*.json for ids ${code((exp.proposalIds || []).join(', ') || 'unknown')} before merging.`);
  }
  L.push('');

  // ── rollback plan ──
  L.push(`## Rollback plan`);
  L.push(`- edge variant: delete/flip the Edge Config key ${code(edgeKey)} entries for the variant pages — instant, server-rendered rollback (\`seo-bot rollback ${slug}\`).`);
  L.push(`- change ledger: reports/${slug}/change-ledger.ndjson journals every write with its BEFORE value (src/change-ledger.mjs) — the rollback pointer for this change.`);
  L.push(`- experiment ledger: reports/${slug}/experiments.ndjson (append-only status history for ${code(exp.id)}).`);
  L.push(`- this source PR itself is git-revertable; **nothing merges without a human.**`);
  L.push('');

  return L.join('\n');
}
