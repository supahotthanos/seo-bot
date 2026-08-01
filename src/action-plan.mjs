// seo-bot · action-plan — deterministic mapper from a deep audit (src/deep-audit.mjs)
// to founder/bot todo tasks. NO LLM decides task existence: every task traces to a
// concrete finding with its evidence, so the plan is reproducible run-to-run (stable
// ids) and empty findings produce an empty plan (fail-closed, never invented work).
//
// Lifecycle rides the EXISTING task ledger (src/tasks.mjs, append-only ndjson,
// dedupe by taskKey) — this module only maps, ranks (src/priority.mjs EV), renders
// (☐/🟡/✅ like onboard/citations), and auto-verifies: a `site:<rule>` task completes
// itself when the rule goes green on a later audit and REOPENS on regression. Founder
// attention is budgeted: "Your week" is capped at FOUNDER_WEEK_MAX tasks.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';
import { rankProposals, SEVERITY_WEIGHT } from './priority.mjs';
import { currentTasks, upsertFromProposals, setStatus } from './tasks.mjs';

export const FOUNDER_WEEK_MAX = 5;
const RUNBOOK = 'research/founder-google-runbook.md';

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
const T = (t) => ({ cadence: 'once', verify: { kind: 'manual', ref: null }, ...t });

/** PURE: deep-audit → tasks. Every branch is a finding→task rule; no finding, no task. */
export function tasksFromDeep(deep = {}, cfg = {}) {
  const tasks = [];
  const add = (t) => tasks.push(T(t));

  // ---- setup gates (the audit itself told us it was flying blind) ----
  if (!cfg.listings?.canonicalNap) add({ id: 'setup:canonical-nap', title: 'Set the canonical NAP (name, street, city, state, zip, phone) in the config', why: 'Citation consistency cannot be audited or fixed without the one true NAP.', how: 'Fill listings.canonicalNap in config/' + (cfg.name || 'client') + '.json exactly as it should appear EVERYWHERE.', owner: 'founder', lane: 'local', effortMin: 10, severity: 'high' });
  if (!cfg.deepAudit?.city) add({ id: 'setup:city', title: 'Set deepAudit.city in the config', why: 'The GBP public capture anchors brand queries with the city.', how: 'Add e.g. "city": "Toronto" under deepAudit.', owner: 'founder', lane: 'local', effortMin: 2, severity: 'medium' });
  if (!(cfg.deepAudit?.competitors || []).length) add({ id: 'setup:competitors', title: 'Name 3-5 map-pack competitors (name + domain) in the config', why: 'Competitor panels give the rating/review/category bar the pack actually requires.', how: 'deepAudit.competitors: [{"name":"...","domain":"..."}] — the spas that actually show in the pack for your money queries.', owner: 'founder', lane: 'local', effortMin: 10, severity: 'medium' });

  // ---- GBP public surface ----
  const client = (deep.gbpPublic?.entities || []).find((e) => e.role === 'client');
  if (client?.status === 'no-panel') add({ id: 'gbp:panel-missing', title: 'Google shows NO business panel for the brand — claim/fix the Business Profile', why: 'No knowledge panel on a brand search usually means an unclaimed/suspended GBP or a name mismatch — the #1 local surface is dark.', how: 'Search the exact brand + city yourself; claim at business.google.com; verify the listing name matches the site.', owner: 'founder', lane: 'local', effortMin: 40, severity: 'critical', verify: { kind: 'capture', ref: 'gbp-panel' } });

  // ---- local factor model ----
  const sevByFactor = new Map((deep.local?.proposals || []).map((p) => [String(p.type || '').replace(/^local-/, ''), p.severity]));
  for (const f of (deep.local?.findings || [])) {
    if (f.status !== 'issue') continue;
    add({ id: `local:${f.factor}`, title: f.recommendation || `Fix local factor: ${f.factor}`, why: `${f.message} [${f.evidenceTier}]`, how: `${f.recommendation || 'See the factor model.'} (${RUNBOOK})`, owner: 'founder', lane: 'local', effortMin: 20, severity: sevByFactor.get(f.factor) || 'medium', verify: { kind: 'capture', ref: f.factor } });
  }
  const rm = deep.local?.reviewMath || {};
  if (rm.threshold?.gap > 0) add({ id: 'local:review-threshold', title: `Get to 10 reviews (${rm.threshold.gap} to go) — the compliant human ask only`, why: 'The 9→10 review threshold gives a measured pack bump (Sterling Sky).', how: `Verbal ask ~24h post-treatment, no incentives, no gating, no automation — the exact script is in ${RUNBOOK}.`, owner: 'founder', lane: 'local', effortMin: 30, severity: 'high', cadence: 'weekly' });
  if (rm.velocity?.stalled) add({ id: 'local:review-velocity', title: 'Review flow is STALLED (past the 18-day window) — restart the weekly ask habit', why: `${rm.velocity.daysSinceLast} days since the last review; velocity decays on an ~18-day half-life.`, how: `Daily front-desk habit per ${RUNBOOK}; track dates only.`, owner: 'founder', lane: 'local', effortMin: 30, severity: 'high', cadence: 'weekly' });

  // ---- citations ----
  for (const r of (deep.citations?.rows || [])) {
    if (r.status === 'live-drift') add({ id: `cite:fix-${r.id}`, title: `Fix NAP drift on ${r.name} (${r.drift.map((d) => d.field).join(', ')})`, why: 'Inconsistent NAP quietly corrodes local trust across the whole citation graph.', how: `Log into the listing (${r.claimUrl || r.publicUrl}) and correct it to the canonical NAP. Rule: ${r.napRule || 'exact match'}.`, owner: 'founder', lane: 'offsite', effortMin: 15, severity: 'high', verify: { kind: 'capture', ref: `citation-${r.id}` } });
    else if (r.status === 'unknown' && r.tier === 1 && r.free) add({ id: `cite:claim-${r.id}`, title: `Claim/verify ${r.name} + paste its public URL into the config`, why: `Tier-1 entity graph: ${r.note || 'feeds the AI + local surfaces'}.`, how: `Claim at ${r.claimUrl}; use the EXACT canonical NAP; then set listings.targets[{id:"${r.id}", publicUrl:"..."}] so liveness is monitored.`, owner: 'founder', lane: 'offsite', effortMin: 25, severity: 'high', verify: { kind: 'capture', ref: `citation-${r.id}` } });
    else if (['unreachable', 'no-nap-found'].includes(r.status)) add({ id: `cite:verify-${r.id}`, title: `Listing check failed for ${r.name} (${r.status}) — verify the URL still works`, why: 'Fail-closed: an unreadable listing is never assumed consistent.', how: `Open ${r.publicUrl} manually; fix or replace the publicUrl in config.`, owner: 'founder', lane: 'offsite', effortMin: 5, severity: 'low' });
  }
  const t34 = (deep.citations?.rows || []).filter((r) => r.status === 'unknown' && r.tier >= 3 && r.free);
  if (t34.length) add({ id: 'cite:tier-3-4', title: `Work down the free directory tier (${t34.length} unclaimed): ${t34.map((r) => r.name).join(', ')}`, why: 'Aggregators propagate NAP downstream (~80% of US distribution); AI-cited directories compound.', how: `One per week is plenty — claim with the canonical NAP, then add each publicUrl to the config. List + links in reports/${cfg.name || ''}/citations.md.`, owner: 'founder', lane: 'offsite', effortMin: 20, severity: 'medium', cadence: 'monthly' });

  // ---- site rules → bot lane (auto-verifies when the rule goes green) ----
  for (const r of (deep.site?.byRule || [])) {
    if (!['critical', 'high', 'medium'].includes(r.severity)) continue;
    add({ id: `site:${r.rule}`, title: `${r.rule} ×${r.count} — ${(r.recommendation || 'fix per rule').slice(0, 110)}`, why: `Site audit: ${r.count} page(s) flagged (${r.severity}).`, how: 'Flows through the normal propose→verify→PR lane; no founder action.', owner: 'bot', lane: 'technical', effortMin: 0, severity: r.severity, verify: { kind: 'rule', ref: r.rule } });
  }

  // ---- readiness gaps (verifier rubric) ----
  const skipGap = /canonical NAP|vertical:medspa/i;
  for (const g of (deep.readiness?.gaps || []).slice(0, 8)) {
    if (skipGap.test(g) && tasks.some((t) => t.id === 'setup:canonical-nap')) continue;
    add({ id: `gap:${slug(g)}`, title: g, why: 'Definition-of-done rubric gap (verifier).', how: g, owner: /`|connect|run |Run /.test(g) ? 'bot' : 'founder', lane: 'measurement', effortMin: 15, severity: 'medium' });
  }

  // ---- spam-risk flags ----
  for (const f of (deep.spamRisk?.flags || [])) {
    add({ id: `risk:${f.id}`, title: `Spam-risk flag: ${f.id}`, why: f.detail, how: f.id === 'content-pause' ? 'Read the cohort guardrail report before resuming publishing.' : 'Investigate + remove the pattern — this is a measured June-2026 loser signal.', owner: f.id === 'programmatic-over-cap' ? 'bot' : 'founder', lane: 'content', effortMin: 30, severity: 'high' });
  }

  // ---- measurement baselines ----
  if (!deep.measurement?.geogrid) add({ id: 'measure:geogrid-baseline', title: 'Capture the geo-grid baseline (ATRP/SoLV envelope)', why: 'Proximity is a hard constraint — without the grid we cannot judge map-pack work honestly.', how: `node bin/seo-bot.mjs geogrid ${cfg.name || '<client>'}`, owner: 'bot', lane: 'measurement', effortMin: 0, severity: 'medium', verify: { kind: 'capture', ref: 'geogrid' } });
  if (!deep.measurement?.gsc?.present || deep.measurement?.gsc?.fresh === false) add({ id: 'measure:gsc-pull', title: 'Refresh the GSC opportunities pull', why: 'Demand data feeds EV ranking; stale demand mis-ranks the plan.', how: `Runs inside the weekly loop once GSC is connected.`, owner: 'bot', lane: 'measurement', effortMin: 0, severity: 'low', verify: { kind: 'capture', ref: 'gsc' } });

  return tasks;
}

/** PURE: rank + split. Founder week = top-N founder tasks by EV; the rest is backlog. */
export function splitPlan(tasks = []) {
  const ranked = rankProposals(tasks.map((t) => ({ ...t, autoApplicable: t.owner === 'bot' })));
  const founder = ranked.filter((t) => t.owner === 'founder');
  const bot = ranked.filter((t) => t.owner === 'bot');
  return { founderWeek: founder.slice(0, FOUNDER_WEEK_MAX), founderBacklog: founder.slice(FOUNDER_WEEK_MAX), botLane: bot };
}

const ICON = { proposed: '☐', queued: '🟡', approved: '🟡', deploying: '🟡', deployed: '✅', verified: '✅', rolled_back: '⛔', rejected: '✖' };
const keyOf = (t) => `${t.id}:${t.lane}`;

/** Merge ledger status onto tasks (proposed when never seen). */
export function mergeLedgerStatus(client, tasks = []) {
  const cur = new Map(currentTasks(client).map((x) => [x.taskKey, x]));
  return tasks.map((t) => { const led = cur.get(keyOf(t)); return { ...t, status: led?.status || 'proposed', ledgerId: led?.id || null }; });
}

/** PURE: the founder-facing markdown checklist. */
export function renderActionPlanMd(plan = {}, { brand = '', ranAt = '' } = {}) {
  const line = (t) => `- ${ICON[t.status] || '☐'} **${t.title}** _(~${t.effortMin}m · ${t.severity}${t.cadence !== 'once' ? ` · ${t.cadence}` : ''})_\n  - Why: ${t.why}\n  - How: ${t.how}`;
  return [
    `# Action plan — ${brand}`, `${String(ranAt).slice(0, 10)} · regenerated by \`deep-audit\`, auto-verified weekly · guide: ${RUNBOOK}`, '',
    `## Your week (founder — the ${FOUNDER_WEEK_MAX} that matter)`,
    ...(plan.founderWeek?.length ? plan.founderWeek.map(line) : ['_nothing needs you this week_']), '',
    '## Founder backlog',
    ...(plan.founderBacklog?.length ? plan.founderBacklog.map(line) : ['_empty_']), '',
    '## Bot lane (flows through propose→verify→PR; auto-checks itself off)',
    ...(plan.botLane?.length ? plan.botLane.map((t) => `- ${ICON[t.status] || '☐'} ${t.id} — ${t.title}`) : ['_empty_']), '',
    '_Statuses ride reports/<client>/tasks.ndjson. `site:*` tasks verify themselves when the rule goes green; `local:*`/`cite:*` verify on the next capture; review-cadence tasks recur weekly by design._',
  ].join('\n');
}

/**
 * Auto-verify + regression-reopen against a fresh deep (or partial: {site} only on
 * weekly diffs). Returns { verified:[], reopened:[] } of taskKeys touched.
 */
export function autoVerify(client, deep = {}) {
  const verified = [], reopened = [];
  const byRule = deep.site?.byRule ? new Set(deep.site.byRule.map((r) => r.rule)) : null;
  const localStatus = new Map((deep.local?.findings || []).map((f) => [f.factor, f.status]));
  const citeStatus = new Map((deep.citations?.rows || []).map((r) => [r.id, r.status]));
  for (const t of currentTasks(client)) {
    const [kind, ...rest] = String(t.taskKey || '').split(':');
    const ref = rest.join(':').replace(/:[a-z]+$/, ''); // strip the lane suffix
    const done = ['verified', 'deployed'].includes(t.status);
    let nowGreen = null;
    if (kind === 'site' && byRule) nowGreen = !byRule.has(ref);
    else if (kind === 'local' && deep.local && localStatus.has(ref)) nowGreen = localStatus.get(ref) === 'ok';
    else if (kind === 'cite' && deep.citations && ref.startsWith('fix-')) { const id = ref.slice(4); if (citeStatus.has(id)) nowGreen = citeStatus.get(id) === 'live-consistent'; }
    if (nowGreen === null) continue; // no evidence this run — leave it alone (fail-closed)
    if (nowGreen && !done && t.status !== 'rejected') { setStatus(client, t.id, 'verified', { actor: 'auto', note: 'evidence green in latest audit/capture' }); verified.push(t.taskKey); }
    else if (!nowGreen && done) { setStatus(client, t.id, 'proposed', { actor: 'auto', note: 'REGRESSION — evidence red again' }); reopened.push(t.taskKey); }
  }
  return { verified, reopened };
}

/** Build + persist the plan from a deep audit; upserts the ledger, merges statuses. */
export function buildActionPlan(cfg, deep, { log = () => {}, save = true } = {}) {
  const ranAt = nowIso();
  const tasks = tasksFromDeep(deep, cfg);
  upsertFromProposals(cfg.name, tasks.map((t) => ({ type: t.id, page: t.lane, severity: t.severity })), { actor: 'deep-audit' });
  const av = autoVerify(cfg.name, deep);
  const merged = mergeLedgerStatus(cfg.name, tasks);
  const plan = { client: cfg.name, brand: cfg.brand, ranAt, ...splitPlan(merged), autoVerified: av };
  if (save) {
    const dir = join(ROOT, 'reports', cfg.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'action-plan.json'), JSON.stringify(plan, null, 2));
    writeFileSync(join(dir, 'action-plan.md'), renderActionPlanMd(plan, { brand: cfg.brand, ranAt }));
    log(`  Action plan: ${plan.founderWeek.length} founder tasks this week · ${plan.founderBacklog.length} backlog · ${plan.botLane.length} bot lane${av.verified.length ? ` · ✅ ${av.verified.length} auto-verified` : ''}${av.reopened.length ? ` · ⚠ ${av.reopened.length} reopened` : ''}`);
    log(`  → reports/${cfg.name}/action-plan.md`);
  }
  return plan;
}
