// seo-bot · experiments/loop — the self-driving step. THE CROWN JEWEL OTTO has nothing like.
//
// OTTO's "autopilot" is threshold rollback (rank drop >2, CTR drop >15%) — it fires on
// small-sample noise, has no control group, no significance, no causal model. This loop is
// "set SEO on autopilot, GATED BY STATISTICS, NOT VIBES." Two phases per run:
//
//   NOMINATE — scan open proposals, find HIGH-TRAFFIC TEMPLATED CLUSTERS (many same-template
//     URLs with real GSC demand) where a head-only, edge-safe variant (title/meta/capsule/
//     schema) is proposed. Split the cluster into matched control/variant buckets balanced on
//     baseline traffic (registry.bucketPages), register the experiment with a LOCKED horizon,
//     and EMIT an apply-edge payload for the variant pages. We DO NOT deploy — we hand the
//     payload to apply/edge.mjs (gated behind --yes + the cloaking guard), exactly like every
//     other write in this codebase. Variant assignment is DETERMINISTIC PER PAGE, so Googlebot
//     and humans get one identical rendering (an experiment, never cloaking).
//
//   EVALUATE — for every experiment past its locked horizon, judge it ONCE (no peeking) with
//     three independent lenses that must AGREE before we act:
//       • controller.evaluateBatch  → DiD/z-test verdict per page + BH-FDR across the batch
//       • counterfactual            → control-as-predictor cumulative-lift CI (causal)
//       • guardrails.decide         → SRM + non-inferiority on conversion/clicks/CWV/citation
//     Fuse → promote-winner (emit a source-PR task + setStatus 'promoted') | rollback-loser
//     (flip the edge key + setStatus 'rolled_back') | inconclusive (advance the backlog).
//
// This module DECIDES and EMITS; it never deploys or merges. It returns a plan the caller
// (orchestrator step / CLI) executes behind the usual confirm gate. Date.now() is allowed here.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso } from '../util.mjs';
import { urlTemplate } from '../crawlbudget.mjs';
import { classifyExperimentSafe } from './classes.mjs';
import { buildOverlay } from '../apply/edge.mjs';
import {
  registerExperiment, setStatus as setExpStatus, bucketPages,
  activeExperiments, dueForEvaluation, currentExperiments,
} from './registry.mjs';
import { evaluateBatch } from '../stats/controller.mjs';
import { counterfactualImpact } from '../stats/counterfactual.mjs';
import { decide as guardrailDecide } from '../stats/guardrails.mjs';
import { minSampleForProportion } from '../stats/significance.mjs';

// Variant classes the edge layer can serve safely are DERIVED from the cloaking guard's
// EDGE_SAFE_FIELDS via experiments/classes.mjs (single source of truth — never restated here).

const pathOf = (cfg, raw) => { try { return new URL(raw || '/', cfg.baseUrl).pathname || '/'; } catch { return (raw || '/').startsWith('/') ? raw : `/${raw}`; } };

/**
 * Cluster key for grouping templated sibling pages. urlTemplate() only collapses digit/hash/
 * long-slug segments, so distinct SHORT slugs (/services/botox vs /services/filler) would each
 * be their own template and never group. For experiments we want the templated-CLUSTER notion:
 * pages that share a parent path with a varying leaf slug ARE the same template. So we first
 * run urlTemplate (handles :id/:slug paths like /p/123 or /blog/2026-the-long-title), then
 * collapse the final slug segment to :leaf so siblings group. A single page at the site root
 * keeps its own key (no false grouping).
 */
export function clusterKey(path) {
  const tmpl = urlTemplate(path);
  const segs = tmpl.split('/').filter(Boolean);
  if (segs.length <= 1) return tmpl;                       // root / single-segment: don't over-group
  const last = segs[segs.length - 1];
  if (last.startsWith(':')) return tmpl;                   // already a placeholder (e.g. :id) — keep
  segs[segs.length - 1] = ':leaf';
  return '/' + segs.join('/');
}

/**
 * Cluster proposals into same-template groups with real demand. A cluster is experiment-worthy
 * when it has >= minPages same-template URLs, the proposal field is edge-safe, and the cluster's
 * total baseline impressions clears minImpressions (high-traffic — where a % CTR lift is worth
 * the experiment's cost). Returns clusters sorted by total demand.
 *
 * @param {object} cfg
 * @param {Array} proposals  decide.mjs proposals (carry .page, .type, optional .gsc)
 * @param {{minPages?:number, minImpressions?:number}} opts
 */
/**
 * POWER GATE — can this cluster's experiment actually CONCLUDE at the locked horizon?
 * A 28-day A/B needs enough impressions per arm to detect a realistic CTR lift; nominating an
 * underpowered cluster burns an experiment slot and a 28-day wait on a verdict that can only
 * ever be "insufficient-data". Sizing via minSampleForProportion (two-proportion, α=.05, power .8).
 * Baseline CTR from the cluster's own GSC clicks when present, else a conservative default.
 * Fail-closed: an unsizeable test (degenerate CTR → Infinity) is NOT powered.
 * @param {{totalImpressions:number, pages?:Array<{proposal?:{gsc?:{clicks?:number}}}>}} cluster
 * @returns {{ok:boolean, expectedPerArm:number, requiredPerArm:number, ctr:number, mdeFloor:number}}
 */
export function powerAtHorizon(cluster, { mdeFloor = 0.2, defaultCtr = 0.03, horizonDays = 28, baselineDays = 28 } = {}) {
  const totalImpr = Number(cluster?.totalImpressions) || 0;
  const scale = baselineDays > 0 && Number.isFinite(horizonDays / baselineDays) ? horizonDays / baselineDays : 1;
  const expectedPerArm = Math.floor((totalImpr * scale) / 2); // 50/50 bucket split
  const clicks = (cluster?.pages || []).reduce((s, p) => s + (Number(p?.proposal?.gsc?.clicks) || 0), 0);
  const ctr = totalImpr > 0 && clicks > 0 ? Math.min(0.999, clicks / totalImpr) : defaultCtr;
  const requiredPerArm = minSampleForProportion(ctr, mdeFloor);
  const ok = Number.isFinite(requiredPerArm) && expectedPerArm >= requiredPerArm;
  return { ok, expectedPerArm, requiredPerArm, ctr, mdeFloor };
}

export function nominateClusters(cfg, proposals = [], { minPages = 4, minImpressions = 500 } = {}) {
  const groups = new Map(); // key: `${template}::${field}` → { template, field, items[] }
  for (const p of proposals) {
    // classes.mjs derives eligibility straight from the cloaking guard's EDGE_SAFE_FIELDS:
    // every head-only class (title/meta/canonical/robots/og/twitter/hreflang/jsonld/capsule)
    // flows into experiments; body/visible-text and UNKNOWN types are refused (fail-closed).
    const cls = classifyExperimentSafe(p);
    if (!cls.safe) continue;
    const field = cls.field;
    const tmpl = clusterKey(pathOf(cfg, p.page));
    const key = `${tmpl}::${field}`;
    const g = groups.get(key) || { template: tmpl, field, variantField: field, items: [] };
    g.items.push(p);
    groups.set(key, g);
  }
  const clusters = [];
  for (const g of groups.values()) {
    // de-dupe to one proposal per page (the highest-priority one)
    const byPage = new Map();
    for (const p of g.items) { const k = pathOf(cfg, p.page); const prev = byPage.get(k); if (!prev || (p.priority || 0) > (prev.priority || 0)) byPage.set(k, p); }
    const pages = [...byPage.values()].map((p) => ({ page: pathOf(cfg, p.page), impressions: p.gsc?.impressions || 0, proposal: p }));
    const totalImpr = pages.reduce((s, x) => s + x.impressions, 0);
    if (pages.length < minPages) continue;
    if (totalImpr < minImpressions) continue;
    clusters.push({ template: g.template, field: g.field, variantField: g.variantField, pages, totalImpressions: totalImpr, pageCount: pages.length });
  }
  return clusters.sort((a, b) => b.totalImpressions - a.totalImpressions);
}

/**
 * NOMINATE phase: turn qualifying clusters into registered experiments + edge-apply payloads.
 * Skips templates that already have an active experiment (no double-testing). Does NOT deploy —
 * returns { nominated:[{experiment, edgePayload}], skipped:[] }. The edgePayload is the exact
 * shape apply/edge.mjs / buildOverlay consume (variant pages only).
 *
 * @param {object} cfg
 * @param {{proposals:Array}} data   latest proposals (from decide.mjs / loadLatestProposals)
 * @param {{log?, horizonDays?, minPages?, minImpressions?, maxNew?, nowMs?, baselineWindow?}} opts
 */
export function nominate(cfg, data, { log = () => {}, horizonDays = 28, minPages = 4, minImpressions = 500, maxNew = 3, nowMs = Date.now(), baselineWindow = null, powerGate = true, mdeFloor = 0.2, defaultCtr = 0.03, baselineDays = 28 } = {}) {
  const client = cfg.name;
  const proposals = data?.proposals || [];
  const activeTemplates = new Set(activeExperiments(client).map((e) => e.template));
  const clusters = nominateClusters(cfg, proposals, { minPages, minImpressions });
  const nominated = [], skipped = [];

  for (const c of clusters) {
    if (nominated.length >= maxNew) break;
    if (activeTemplates.has(c.template)) { skipped.push({ template: c.template, reason: 'already has an active experiment' }); continue; }

    // POWER GATE (statistics, not vibes): refuse experiments that cannot conclude at the horizon.
    // An underpowered cluster gets its fix shipped DETERMINISTICALLY (normal propose→apply path)
    // instead of burning a 28-day locked horizon on a guaranteed "insufficient-data".
    if (powerGate) {
      const pw = powerAtHorizon(c, { mdeFloor, defaultCtr, horizonDays, baselineDays });
      if (!pw.ok) {
        skipped.push({ template: c.template, reason: `underpowered — expected ~${pw.expectedPerArm} impressions/arm at horizon, need ≥${Number.isFinite(pw.requiredPerArm) ? pw.requiredPerArm : '∞'} to detect a ${Math.round(pw.mdeFloor * 100)}% CTR lift; ship the fix deterministically instead`, power: pw });
        continue;
      }
    }

    const split = bucketPages(c.pages, { ratio: 0.5, experimentId: `${c.template}::${c.variantField}` });
    if (!split.variant.length || !split.control.length) { skipped.push({ template: c.template, reason: split.reason || 'could not split into two buckets' }); continue; }

    const exp = registerExperiment(client, {
      template: c.template,
      hypothesis: `Edge variant on "${c.variantField}" lifts CTR on the ${c.template} cluster (${c.pageCount} pages, ${c.totalImpressions} baseline impr).`,
      variantField: c.variantField,
      controlPages: split.control,
      variantPages: split.variant,
      baselineWindow,
      expectedRatio: [0.5, 0.5],
      proposalIds: c.pages.map((p) => p.proposal.id),
      meta: { totalImpressions: c.totalImpressions, balance: split.balance },
    }, { horizonDays, nowMs });

    // Build the edge-apply payload for the VARIANT pages only (the control keeps the status quo).
    const variantSet = new Set(split.variant);
    const variantProposals = c.pages.filter((p) => variantSet.has(p.page)).map((p) => ({ ...p.proposal, page: p.page }));
    const { overlay, ruleCount } = buildOverlay(cfg, variantProposals);

    nominated.push({
      experiment: exp,
      edgePayload: { client, experimentId: exp.id, ruleCount, proposals: variantProposals, overlay },
    });
    log(`  ⚗ nominated ${exp.id} · ${c.template} (${c.variantField}) — ${split.variant.length} variant / ${split.control.length} control pages, horizon ${exp.lockedHorizonDate}`);
  }
  if (!nominated.length) log(`  no new experiments nominated (${clusters.length} candidate cluster(s), ${skipped.length} skipped).`);
  return { nominated, skipped, clusters: clusters.length };
}

/**
 * Build the {control, variant} before/after series for one experiment from a metrics provider.
 * `getSeries(pages, window)` must return per-period totals {clicks[],impressions[]} for the set.
 * Pure orchestration over whatever the caller fetched (GSC). Returns null if data missing.
 */
function buildExperimentSeries(exp, metrics) {
  const m = metrics?.[exp.id];
  if (!m || !m.control || !m.variant) return null;
  return m; // { control:{before:{clicks,impressions}, after:{...}, baselineDaily:[], postDaily:[]}, variant:{...}, days, guardrail? }
}

/**
 * EVALUATE phase: judge every experiment past its locked horizon with all three lenses and
 * fuse into an action. Requires a `metrics` map: { [experimentId]: {
 *   control:{ before:{clicks,impressions}, after:{clicks,impressions}, daily?:{baseline:[],post:[]} },
 *   variant:{ before:{clicks,impressions}, after:{clicks,impressions}, daily?:{baseline:[],post:[]} },
 *   days, guardrail?:{ split?, conversion?, clicks?, cwv?, citation? } } }
 * (the caller fetches these from GSC/GA4/CrUX/measure — kept out of this pure decision step).
 *
 * @returns {{decisions:[{experimentId, action, ...}], evaluated:number}}
 *   action ∈ promote | rollback | inconclusive | insufficient | hold
 */
export function evaluate(cfg, { metrics = {}, log = () => {}, nowMs = Date.now(), opts = {} } = {}) {
  const client = cfg.name;
  const due = dueForEvaluation(client, { nowMs });
  const decisions = [];

  for (const exp of due) {
    const series = buildExperimentSeries(exp, metrics);
    if (!series) { decisions.push({ experimentId: exp.id, template: exp.template, action: 'insufficient', reason: 'no metrics supplied for this experiment yet (GSC/GA4 not connected or no overlap).' }); log(`  ⏸ ${exp.id}: insufficient (no metrics)`); continue; }

    // LENS 1 — controller (DiD vs the matched control + BH-FDR is applied across this batch run).
    const change = {
      id: exp.id, page: exp.template,
      before: series.variant.before, after: series.variant.after,
      control: { before: series.control.before, after: series.control.after },
      days: series.days || exp.horizonDays,
      guardrail: series.guardrail?.conversionPair || null, // {before:{conversions,sessions},after:{...}} if provided
      lockedHorizonDate: exp.lockedHorizonDate,
    };
    const [verdict] = evaluateBatch([change], { opts: { ...opts, nowMs } });

    // LENS 2 — counterfactual on daily series (causal cumulative-lift CI), when daily data exists.
    let cf = null;
    if (series.variant.daily && series.control.daily) {
      cf = counterfactualImpact({
        controlBaseline: series.control.daily.baseline || [],
        variantBaseline: series.variant.daily.baseline || [],
        controlPost: series.control.daily.post || [],
        variantPost: series.variant.daily.post || [],
      }, { model: opts.cfModel || 'ratio' });
    }

    // LENS 3 — guardrails (SRM + non-inferiority). Fail-closed: blocks promotion on any breach.
    const guard = guardrailDecide(series.guardrail || {}, { marginPct: opts.guardrailMargin ?? 0.1, cwvMarginPct: opts.cwvMargin ?? 0.1 });

    // FUSE. All three must agree for a promote; ANY guardrail breach or SRM forces rollback.
    let action, reason;
    if (guard.decision === 'rollback') {
      action = 'rollback'; reason = `guardrail/SRM breach → rollback. ${guard.reason}`;
    } else if (verdict.decision === 'revert' || (cf && cf.ok && cf.significant && cf.direction === 'down')) {
      action = 'rollback'; reason = `significant regression (controller=${verdict.decision}${cf ? `, counterfactual=${cf.direction} p=${cf.pValue?.toFixed?.(3)}` : ''}) → rollback the edge variant.`;
    } else if (verdict.decision === 'keep' && (!cf || (cf.ok && cf.direction === 'up')) && guard.decision === 'keep') {
      action = 'promote'; reason = `significant + practical CTR win (controller=keep${cf ? `, counterfactual +${cf.cumulativeLift?.toFixed?.(1)} clicks, CI excludes 0` : ''}), guardrails non-inferior → graduate to a SOURCE PR.`;
    } else if (verdict.decision === 'insufficient-data' || guard.decision === 'insufficient') {
      action = 'insufficient'; reason = `not enough data to judge at horizon (controller=${verdict.decision}, guardrails=${guard.decision}) — extend or re-run.`;
    } else {
      action = 'inconclusive'; reason = `lever inert (controller=${verdict.decision}${cf ? `, counterfactual=${cf.direction}` : ''}) — revert the edge variant to baseline, advance the backlog.`;
    }

    decisions.push({
      experimentId: exp.id, template: exp.template, variantField: exp.variantField,
      action, reason,
      variantPages: exp.variantPages, controlPages: exp.controlPages,
      proposalIds: exp.proposalIds, taskIds: exp.taskIds || [],
      lenses: { controller: { decision: verdict.decision, pValue: verdict.pValue, passedFDR: verdict.passedFDR, reason: verdict.reason }, counterfactual: cf ? { ok: cf.ok, cumulativeLift: cf.cumulativeLift, ci: cf.ci, pValue: cf.pValue, direction: cf.direction, significant: cf.significant } : null, guardrails: { decision: guard.decision, breaches: guard.breaches, srm: guard.srm?.mismatch ?? null } },
    });
    log(`  ${action === 'promote' ? '🏆' : action === 'rollback' ? '↩' : '•'} ${exp.id} · ${exp.template} → ${action.toUpperCase()} — ${reason}`);
  }
  return { decisions, evaluated: due.length };
}

/**
 * Apply the evaluation decisions to experiment + task state, and emit the side-effect plan
 * (source-PR for winners, edge-key removal for losers). DOES NOT deploy or merge — it records
 * the state transition (so the loop is idempotent / queryable) and returns actions the caller
 * executes behind the confirm gate.
 *
 * @param {object} cfg
 * @param {Array} decisions  from evaluate()
 * @param {{log?, confirm?, nowMs?}} opts
 * @returns {{promote:[], rollback:[], setStatusCalls:[]}}
 */
export async function applyDecisions(cfg, decisions, { log = () => {}, confirm = false, nowMs = Date.now() } = {}) {
  const client = cfg.name;
  const plan = { promote: [], rollback: [], setStatusCalls: [] };
  let tasksMod = null;
  try { tasksMod = await import('../tasks.mjs'); } catch { /* tasks are best-effort */ }

  for (const d of decisions) {
    const firstNew = plan.setStatusCalls.length; // only THIS decision's calls execute below (re-running earlier ones would append duplicate ledger events with the wrong extra)
    // The three-lens verdict + evaluation timestamp ride the status transition into the
    // experiments ledger, so the graduation evidence bundle can be rebuilt from the record alone.
    const lensExtra = { decision: d.action, decisionReason: d.reason, lenses: d.lenses || null, evaluatedAt: new Date(nowMs).toISOString() };
    if (d.action === 'promote') {
      plan.promote.push({ experimentId: d.experimentId, template: d.template, variantField: d.variantField, variantPages: d.variantPages, proposalIds: d.proposalIds, note: 'graduate edge variant → source PR (apply/nextjs.mjs), then remove the edge override.' });
      plan.setStatusCalls.push({ scope: 'experiment', id: d.experimentId, status: 'promoted', extra: lensExtra });
      plan.setStatusCalls.push(...(d.taskIds || []).map((id) => ({ scope: 'task', id, status: 'approved', note: 'experiment won — promote to source PR' })));
    } else if (d.action === 'rollback') {
      plan.rollback.push({ experimentId: d.experimentId, template: d.template, variantPages: d.variantPages, edgeKey: cfg.edge?.key || 'seoOverlay', note: 'remove the variant edge override (flip the Edge Config key) — instant, server-rendered rollback.' });
      plan.setStatusCalls.push({ scope: 'experiment', id: d.experimentId, status: 'rolled_back', extra: lensExtra });
      plan.setStatusCalls.push(...(d.taskIds || []).map((id) => ({ scope: 'task', id, status: 'rolled_back', note: 'experiment lost or breached a guardrail' })));
    } else if (d.action === 'inconclusive') {
      plan.rollback.push({ experimentId: d.experimentId, template: d.template, variantPages: d.variantPages, edgeKey: cfg.edge?.key || 'seoOverlay', note: 'lever inert — revert edge variant to baseline.' });
      plan.setStatusCalls.push({ scope: 'experiment', id: d.experimentId, status: 'inconclusive', extra: lensExtra });
      plan.setStatusCalls.push(...(d.taskIds || []).map((id) => ({ scope: 'task', id, status: 'rolled_back', note: 'experiment inconclusive' })));
    } // 'insufficient'/'hold' → leave running, no state change

    // Persist THIS decision's state transitions now (append-only ledger). Tasks too, when confirm.
    if (confirm) {
      const newCalls = plan.setStatusCalls.slice(firstNew);
      for (const c of newCalls.filter((s) => s.scope === 'experiment')) {
        try { setExpStatus(client, c.id, c.status, { nowMs, extra: c.extra || { decision: d.action } }); } catch (e) { log(`  ! could not set experiment ${c.id} → ${c.status}: ${e.message}`); }
      }
      if (tasksMod) for (const c of newCalls.filter((s) => s.scope === 'task')) {
        try { tasksMod.setStatus(client, c.id, c.status, { actor: 'auto', note: c.note }); } catch { /* task may not exist */ }
      }
    }
  }
  if (!confirm && (plan.promote.length || plan.rollback.length)) log(`  (preview — pass --yes/confirm to record experiment + task transitions and emit PR/edge actions)`);
  return plan;
}

/**
 * The full self-driving step for one client. NOMINATE new experiments (emit edge payloads) +
 * EVALUATE due ones (fuse three lenses) + record transitions. Writes a plan artifact for the
 * caller/orchestrator to execute behind the confirm gate. Never deploys or merges here.
 *
 * @param {object} cfg
 * @param {object} input { proposals?, metrics?, baselineWindow? } — proposals for nomination,
 *   metrics map for evaluation (both optional; phase runs only when its input is present).
 * @param {{log?, confirm?, nowMs?, horizonDays?, minPages?, minImpressions?, maxNew?, opts?}} o
 */
export async function selfDriveStep(cfg, input = {}, o = {}) {
  const { log = () => {}, confirm = false, nowMs = Date.now(), horizonDays = 28, minPages = 4, minImpressions = 500, maxNew = 3, opts = {} } = o;
  const client = cfg.name;
  log(`\n⚗ self-driving experiment loop · ${cfg.brand}`);

  // EVALUATE first (act on what's ripe before launching more).
  const ev = evaluate(cfg, { metrics: input.metrics || {}, log, nowMs, opts });
  const decisionPlan = await applyDecisions(cfg, ev.decisions, { log, confirm, nowMs });

  // NOMINATE new experiments from the latest proposals.
  let nom = { nominated: [], skipped: [], clusters: 0 };
  if (input.proposals?.length) {
    nom = nominate(cfg, { proposals: input.proposals }, { log, horizonDays, minPages, minImpressions, maxNew, nowMs, baselineWindow: input.baselineWindow || null });
    // Mark nominated experiments 'launched' once their edge payload is emitted (or actually applied by the caller).
    if (confirm) for (const n of nom.nominated) { try { setExpStatus(client, n.experiment.id, 'launched', { nowMs }); } catch (e) { log(`  ! could not launch ${n.experiment.id}: ${e.message}`); } }
  }

  const summary = {
    client, ranAt: nowIso(),
    evaluated: ev.evaluated,
    promoted: ev.decisions.filter((d) => d.action === 'promote').length,
    rolledBack: ev.decisions.filter((d) => d.action === 'rollback' || d.action === 'inconclusive').length,
    inconclusive: ev.decisions.filter((d) => d.action === 'inconclusive').length,
    insufficient: ev.decisions.filter((d) => d.action === 'insufficient').length,
    nominated: nom.nominated.length,
    candidateClusters: nom.clusters,
    active: activeExperiments(client).length,
    decisions: ev.decisions,
    nominatedExperiments: nom.nominated.map((n) => ({ id: n.experiment.id, template: n.experiment.template, variantField: n.experiment.variantField, lockedHorizonDate: n.experiment.lockedHorizonDate, edgeRuleCount: n.edgePayload.ruleCount })),
    plan: decisionPlan,
  };

  // Persist the plan artifact (versioned, like edge-rules.json / decisions.ndjson).
  const dir = join(ROOT, 'reports', client);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'experiments-plan.json'), JSON.stringify(summary, null, 2));
  log(`  plan → reports/${client}/experiments-plan.json · ${summary.nominated} nominated, ${summary.evaluated} evaluated (${summary.promoted} promote, ${summary.rolledBack} revert, ${summary.insufficient} wait)`);
  return summary;
}
