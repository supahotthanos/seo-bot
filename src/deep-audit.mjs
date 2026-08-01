// seo-bot · deep-audit — the founders+AI Google-local super audit. COMPOSITION, not new
// analysis: one run unifies the engines that each write their own file today (site audit,
// local factor model, review math, GBP public capture, citation liveness, verifier gaps,
// off-site gaps, geogrid, GSC freshness, spam-risk self-check, tactic coverage) into ONE
// consolidated document that src/action-plan.mjs turns into founder/bot todo tasks.
//
// Posture: every section is fail-soft (a broken engine records {error} and the rest keep
// going — a deep audit that dies on one probe is useless) but each section's CONTENT is
// fail-closed (missing data reports 'unknown', blocked captures stay blocked, nothing is
// guessed). Cadence: monthly full run (weekly diffs ride src/action-plan.mjs on the
// ordinary weekly audit).

import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';
import { runAudit } from './audit.mjs';
import { assessLocal, suppressDebunked, DEBUNKED } from './local/factors.mjs';
import { signalsFromCfg, latestGeogrid } from './local/index.mjs';
import { velocityScore, thresholdGap, justificationCheck } from './local/reviews.mjs';
import { captureGbpPublic, toLocalSignals } from './local/gbp-public.mjs';
import { citationLiveness } from './offsite/citation-liveness.mjs';
import { verifyBot } from './verifier.mjs';
import { actionable, tacticsView } from './tactics/registry.mjs';

const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null; } catch { return null; } };
const ageDays = (p) => { try { return (Date.now() - statSync(p).mtimeMs) / 86400000; } catch { return null; } };

/** Fail-soft section runner: an engine that throws becomes { error }, never a dead audit. */
async function section(name, fn, log) {
  try { return await fn(); }
  catch (e) { const msg = String(e?.message || e).slice(0, 200); log(`  deep-audit: section "${name}" failed — ${msg}`); return { error: msg }; }
}

/** PURE: the spam-risk self-check from already-on-disk artifacts + the site audit. */
export function spamRiskCheck(cfg = {}, siteAudit = null, { dir = null } = {}) {
  const out = { flags: [], notes: [] };
  const byRule = new Map((siteAudit?.byRule || []).map((r) => [r.rule, r]));
  if (byRule.has('ad-density')) out.flags.push({ id: 'ad-density', detail: `${byRule.get('ad-density').count} page(s) over the ad-slot density line (strongest measured June-2026 loser signal)` });
  if (byRule.has('intrusive-ux')) out.flags.push({ id: 'intrusive-ux', detail: 'push/interstitial patterns detected (0 surviving spam-update sites used them)' });
  if (byRule.has('self-ranked-listicle')) out.flags.push({ id: 'self-ranked-listicle', detail: 'a "best of" page ranks the business itself (Jun-2026 demotion cohort)' });
  if (dir) {
    if (existsSync(join(dir, 'content-pause.flag'))) out.flags.push({ id: 'content-pause', detail: 'cohort guardrail tripped — publishing is paused; investigate before resuming' });
    const plan = readJson(join(dir, 'content-plan.json'));
    const planned = Array.isArray(plan?.pages) ? plan.pages.length : Array.isArray(plan) ? plan.length : null;
    const cap = cfg.content?.maxProgrammaticPages ?? 200;
    if (planned !== null) {
      if (planned > cap) out.flags.push({ id: 'programmatic-over-cap', detail: `content plan holds ${planned} pages vs cap ${cap}` });
      else out.notes.push(`content plan ${planned} pages (cap ${cap}) — inside the scaled-content rail`);
    }
    const scores = existsSync(join(dir, 'content-scores.ndjson')) ? readFileSync(join(dir, 'content-scores.ndjson'), 'utf-8').trim().split('\n').filter(Boolean) : [];
    let published7d = 0;
    const weekAgo = Date.now() - 7 * 86400000;
    for (const l of scores) { try { const j = JSON.parse(l); if (j.published && Date.parse(j.at || j.ranAt || 0) > weekAgo) published7d++; } catch { /* */ } }
    const maxWk = cfg.content?.maxPostsPerWeek ?? 7;
    if (published7d > maxWk) out.flags.push({ id: 'publish-burst', detail: `${published7d} posts published in 7d vs weekly cap ${maxWk}` });
    else out.notes.push(`${published7d} posts published in the last 7d (cap ${maxWk})`);
  }
  out.clean = out.flags.length === 0;
  return out;
}

/**
 * Run the deep audit. Injectables: fetchHtml (GBP panel capture), fetchFn (citation pages),
 * capture:false skips the live GBP lane entirely (weekly diffs; tests).
 */
export async function runDeepAudit(cfg, { log = () => {}, fetchHtml = null, fetchFn = globalThis.fetch, capture = true, save = true, runAuditImpl = runAudit, verifyBotImpl = verifyBot } = {}) {
  const ranAt = nowIso();
  const dir = join(ROOT, 'reports', cfg.name);
  log(`\n  Deep audit — ${cfg.brand} (${ranAt.slice(0, 10)})`);

  // 1 — site audit (rules engine incl. medspa + local packs)
  const site = await section('site', () => runAuditImpl(cfg, { log }), log);

  // 2 — GBP public capture (client + competitors)
  const gbpPublic = capture
    ? await section('gbp-public', () => captureGbpPublic(cfg, { fetchHtml, log }), log)
    : { skipped: true, entities: [] };

  // 3 — local factor model on merged signals: captured public surface first, explicit
  //     cfg.local values OVER it (an owner-supplied signal beats a scraped guess).
  const local = await section('local', async () => {
    const signals = { ...toLocalSignals(gbpPublic), ...signalsFromCfg(cfg) };
    const assessed = assessLocal(cfg, signals);
    const { kept, flagged } = suppressDebunked(assessed.proposals);
    const rv = (signals.reviews && typeof signals.reviews === 'object') ? signals.reviews : {};
    const reviewMath = {
      velocity: Array.isArray(rv.dates) ? velocityScore(rv.dates) : { score: null, reason: 'no review dates (public panel shows counts, not dates — paste dates into cfg.local.reviews.dates or leave unknown)' },
      threshold: Number.isFinite(rv.count) ? thresholdGap(rv.count) : { gap: null, reason: 'no review count observed' },
      justifications: Array.isArray(rv.texts) ? justificationCheck(rv.texts, cfg.services || []) : { total: null, reason: 'no review texts supplied' },
    };
    return { findings: assessed.findings, proposals: kept, suppressed: flagged, reviewMath, signalsUsed: Object.keys(signals) };
  }, log);

  // 4 — citation liveness (registry × nap-drift)
  const citations = await section('citations', () => citationLiveness(cfg, { fetchFn, log }), log);

  // 5 — readiness gaps (verifier rubric, quiet)
  const readiness = await section('readiness', async () => { const v = verifyBotImpl(cfg, { log: () => {} }); return { score: v.score, gaps: v.gaps, components: v.components }; }, log);

  // 6 — measurement context (geogrid + GSC + off-site gaps from the last loop)
  const geogrid = latestGeogrid(cfg.name);
  const gscAge = ageDays(join(dir, 'gsc-opportunities.md'));
  const runLatest = readJson(join(dir, 'run-latest.json'));
  const measurement = {
    geogrid,
    gsc: gscAge === null ? { present: false } : { present: true, ageDays: Math.round(gscAge), fresh: gscAge <= 14 },
    offsiteTopGaps: Array.isArray(runLatest?.topGaps) ? runLatest.topGaps.slice(0, 8) : [],
  };

  // 7 — spam-risk self-check
  const spamRisk = spamRiskCheck(cfg, site?.error ? null : site, { dir });

  // 8 — tactic posture: what the bot may act on now + the hard NEVER list
  const hats = tacticsView();
  const tactics = {
    actionable: actionable(cfg).map((t) => ({ id: t.id, automatable: t.automatable })),
    optedIn: cfg.tacticsOptIn || [],
    neverList: [...hats.black.map((t) => t.id), ...DEBUNKED.map((d) => d.id)],
  };

  const deep = { client: cfg.name, brand: cfg.brand, baseUrl: cfg.baseUrl, ranAt, site: site?.error ? site : { score: site.score, pageCount: site.pageCount, bySeverity: site.bySeverity, byRule: site.byRule, siteFindings: site.siteFindings }, gbpPublic, local, citations, readiness, measurement, spamRisk, tactics };

  if (save) {
    mkdirSync(dir, { recursive: true });
    const day = ranAt.slice(0, 10);
    writeFileSync(join(dir, `deep-audit-${day}.json`), JSON.stringify(deep, null, 2));
    writeFileSync(join(dir, `deep-audit-${day}.md`), renderDeepAuditMd(deep));
    writeFileSync(join(dir, 'deep-audit-latest.json'), JSON.stringify(deep, null, 2));
    log(`  → reports/${cfg.name}/deep-audit-${day}.md`);
  }
  return deep;
}

/** PURE: the human-readable consolidated report. */
export function renderDeepAuditMd(deep = {}) {
  const L = [`# Deep audit — ${deep.brand}`, `${deep.baseUrl || ''} · ${String(deep.ranAt).slice(0, 10)}`, ''];
  const site = deep.site || {};
  if (site.error) L.push(`## Site audit`, `_failed: ${site.error}_`, '');
  else {
    L.push(`## Site audit — health ${site.score}/100 (${site.pageCount} pages)`,
      `🔴 ${site.bySeverity?.critical ?? 0} · 🟠 ${site.bySeverity?.high ?? 0} · 🟡 ${site.bySeverity?.medium ?? 0} · ⚪ ${site.bySeverity?.low ?? 0}`, '');
    for (const r of (site.byRule || []).slice(0, 12)) L.push(`- ${r.severity} · **${r.rule}** ×${r.count} — ${r.recommendation || ''}`);
    L.push('');
  }
  const ents = deep.gbpPublic?.entities || [];
  L.push('## Public Google Business surface');
  if (deep.gbpPublic?.skipped) L.push('_capture skipped this run (weekly diff mode)_');
  else if (!ents.length) L.push('_no entities captured — configure brand + deepAudit.competitors_');
  for (const e of ents) {
    if (e.status === 'ok') L.push(`- **${e.brand}** (${e.role}): ${e.panel.categoryShown || '?'} · ⭐${e.panel.rating ?? '?'} · ${e.panel.reviewCount ?? '?'} reviews · hours ${e.panel.hoursShown ? 'shown' : 'not shown'}`);
    else L.push(`- **${e.brand}** (${e.role}): ${e.status}${e.status === 'blocked' ? ' — EXCLUDED, not zeros' : e.status === 'no-panel' ? ' — panel not found (unclaimed GBP or ambiguous brand?)' : ''}`);
  }
  L.push('');
  const lf = deep.local || {};
  if (!lf.error) {
    const issues = (lf.findings || []).filter((f) => f.status === 'issue');
    const unknowns = (lf.findings || []).filter((f) => f.status === 'unknown');
    L.push(`## Local factor model — ${issues.length} issues · ${unknowns.length} unknown`);
    for (const f of issues) L.push(`- 🔴 **${f.factor}** — ${f.message}`);
    for (const f of unknowns) L.push(`- ❔ ${f.factor} — ${f.message}`);
    if (lf.suppressed?.length) L.push(`- ⛔ ${lf.suppressed.length} debunked proposal(s) suppressed`);
    L.push('');
  }
  const cit = deep.citations || {};
  L.push('## Citations');
  if (cit.refused) L.push(`_refused: ${cit.reason}_`);
  else if (cit.summary) L.push(`${cit.summary['live-consistent']}/${cit.summary.total} verified-consistent · ${cit.summary['live-drift']} drift · ${cit.summary.unknown} unknown`);
  for (const r of (cit.rows || []).filter((x) => x.status !== 'live-consistent').slice(0, 12)) L.push(`- ${r.status === 'live-drift' ? '🟠' : '☐'} T${r.tier} **${r.name}** — ${r.status}${r.drift?.length ? ` (${r.drift.map((d) => d.field).join(', ')})` : ''}`);
  L.push('');
  if (deep.readiness && !deep.readiness.error) {
    L.push(`## Readiness — ${deep.readiness.score}/100`, ...(deep.readiness.gaps || []).slice(0, 8).map((g) => `- ☐ ${g}`), '');
  }
  const m = deep.measurement || {};
  L.push('## Measurement',
    m.geogrid ? `- Geo-grid: ATRP ${m.geogrid.atrp} · SoLV ${m.geogrid.solv}% ("${m.geogrid.keyword}")` : '- Geo-grid: no baseline yet — run `geogrid`',
    m.gsc?.present ? `- GSC opportunities: ${m.gsc.fresh ? 'fresh' : `stale (${m.gsc.ageDays}d)`}` : '- GSC opportunities: not pulled yet',
    ...(m.offsiteTopGaps?.length ? [`- Off-site gaps: ${m.offsiteTopGaps.slice(0, 5).map((g) => g.host || g).join(' · ')}`] : []), '');
  const sr = deep.spamRisk || {};
  L.push(`## Spam-risk self-check — ${sr.clean ? '✅ clean' : `⚠ ${sr.flags.length} flag(s)`}`);
  for (const f of (sr.flags || [])) L.push(`- ⚠ **${f.id}** — ${f.detail}`);
  for (const n of (sr.notes || [])) L.push(`- ${n}`);
  L.push('', `## Never list (suppressed by code)`, (deep.tactics?.neverList || []).map((t) => `~~${t}~~`).join(' · '), '');
  return L.join('\n');
}
