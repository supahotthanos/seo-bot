// seo-bot · scripts/evidence-audit — DATA-SCIENCE DISCIPLINE enforcement (GOAL criterion 2).
//
// Scans the bot's emitted artifacts for NAKED POINT ESTIMATES — a rate/share/verdict published
// without its confidence interval, denominator, or an explicit suppression/insufficiency state.
// The rule of the house: every number carries its uncertainty or it doesn't ship. This audit is
// the artifact that proves it: zero violations = criterion satisfied; any violation names the
// exact file and field. Deterministic, no LLM, fail-closed (unparseable artifact = violation —
// an unreadable report can't prove its own honesty).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../src/config.mjs';

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** PURE: audit one SoV/visibility KPI object. Every reported rate needs ci OR suppression. */
export function auditSovObject(sov, file = 'sov') {
  const v = [];
  const kpis = [];
  if (sov && typeof sov === 'object') {
    for (const key of ['visibility', 'shareOfVoice', 'sov', 'avgPosition', 'mentionRate']) if (key in sov) kpis.push([key, sov[key]]);
    for (const [engine, obj] of Object.entries(sov.engines || sov.byEngine || {})) for (const key of ['visibility', 'shareOfVoice']) if (obj && key in obj) kpis.push([`${engine}.${key}`, obj[key], obj]);
  }
  for (const [where, val, ctx] of kpis) {
    const o = ctx || sov;
    if (val === null || val === undefined) continue; // honest absence
    const suppressed = o.belowNoiseFloor === true || o.suppressed === true || o.status === 'suppressed';
    const hasCi = (o.ci && num(o.ci.lo ?? o.ci.low ?? o.ci[0]) ) || num(o.ciHalfWidth) || num(o.ciLow);
    const hasN = num(o.answers) || num(o.n) || num(o.denominator) || num(o.samples);
    if (num(val) && !suppressed && !hasCi && !hasN) v.push({ file, where, why: 'rate reported without CI, denominator, or suppression state' });
  }
  return v;
}

/** PURE: brand-fanout KPI must respect its run floor. */
export function auditFanoutKpi(kpi, file = 'fanout-kpi') {
  const v = [];
  if (!kpi || typeof kpi !== 'object') return v;
  if (kpi.status === 'insufficient-runs') return v; // the honest state
  const shares = ['brandShare', 'competitorShare'].filter((k) => num(kpi[k]));
  if (shares.length && !num(kpi.runs)) v.push({ file, where: shares.join(','), why: 'fan-out share without runs count (variance floor unverifiable)' });
  if (shares.length && num(kpi.runs) && kpi.runs < 5) v.push({ file, where: shares.join(','), why: `fan-out share printed with runs=${kpi.runs} (<5 floor — should be insufficient-runs)` });
  return v;
}

/** PURE: decisions rows — an acted verdict must carry its statistical basis. */
export function auditDecisionRow(row, file = 'decisions.ndjson') {
  const v = [];
  if (!row || typeof row !== 'object') return v;
  const acted = ['keep', 'revert', 'try-next'].includes(row.decision);
  if (!acted) return v; // hold / insufficient-data ARE the honest states
  const basis = num(row.pValue) || num(row.p) || (row.test && num(row.test.pValue)) || (row.stats && num(row.stats.pValue));
  const n = num(row.n) || num(row.impressions) || (row.sample && num(row.sample.n)) || (row.test && (num(row.test.n1) || num(row.test.n)));
  if (!basis || !n) v.push({ file, where: `${row.id || row.taskKey || 'row'}:${row.decision}`, why: 'acted verdict without p-value + sample size' });
  return v;
}

/** PURE: markdown spot-rule — SoV/visibility % lines must carry ±/CI/n=/suppressed. */
export function auditReportMd(md, file = 'report.md') {
  const v = [];
  for (const line of String(md).split('\n')) {
    if (!/\d+(\.\d+)?\s*%/.test(line)) continue;
    if (!/\b(SoV|share of voice|visibilit)/i.test(line)) continue;
    if (/±|\bCI\b|n\s*=|\(n[:=]|suppressed|below noise|insufficient/i.test(line)) continue;
    v.push({ file, where: line.trim().slice(0, 80), why: 'visibility % in prose without CI/denominator/suppression' });
  }
  return v;
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return undefined; } };

/** Audit one client's report directory (+ the dashboard bundle). */
export function auditClientDir(dir, label = '') {
  const violations = [];
  let checked = 0;
  if (!existsSync(dir)) return { checked, violations };
  const files = readdirSync(dir);
  for (const f of files) {
    const p = join(dir, f);
    if (/^sov.*\.json$/i.test(f)) { checked++; const j = readJson(p); if (j === undefined) violations.push({ file: `${label}${f}`, where: '(parse)', why: 'unparseable artifact (fail-closed)' }); else violations.push(...auditSovObject(j.sov || j, `${label}${f}`)); }
    if (/fanout-(kpi|brand).*\.json$/i.test(f)) { checked++; const j = readJson(p); if (j === undefined) violations.push({ file: `${label}${f}`, where: '(parse)', why: 'unparseable artifact (fail-closed)' }); else violations.push(...auditFanoutKpi(j, `${label}${f}`)); }
    if (f === 'decisions.ndjson') { checked++; for (const line of readFileSync(p, 'utf8').split('\n').filter(Boolean)) { const row = readJson === undefined ? undefined : (() => { try { return JSON.parse(line); } catch { return undefined; } })(); if (row === undefined) violations.push({ file: `${label}${f}`, where: '(parse)', why: 'unparseable decision row' }); else violations.push(...auditDecisionRow(row, `${label}${f}`)); } }
    if (f === 'dashboard-bundle.json') { checked++; const j = readJson(p); if (j?.visibility?.sov) violations.push(...auditSovObject(j.visibility.sov, `${label}${f}#visibility.sov`)); if (j?.visibility?.fanoutKpi) violations.push(...auditFanoutKpi(j.visibility.fanoutKpi, `${label}${f}#visibility.fanoutKpi`)); }
    if (/^(latest|run-.*|weekly.*)\.md$/i.test(f)) { checked++; violations.push(...auditReportMd(readFileSync(p, 'utf8'), `${label}${f}`)); }
  }
  return { checked, violations };
}

export function evidenceAudit({ client = null, log = console.log } = {}) {
  const base = join(ROOT, 'reports');
  const clients = client ? [client] : (existsSync(base) ? readdirSync(base).filter((d) => !d.startsWith('_') && d !== 'query-bank' && existsSync(join(base, d)) && !d.includes('.')) : []);
  let checked = 0; const violations = [];
  for (const c of clients) { const r = auditClientDir(join(base, c), `${c}/`); checked += r.checked; violations.push(...r.violations); }
  // In-house query-bank panels (reports/query-bank/<client>/report.md) — every SoV/visibility % must
  // carry its CI + denominator, same rule as the weekly reports.
  const qbBase = join(base, 'query-bank');
  if (existsSync(qbBase)) for (const c of readdirSync(qbBase)) {
    if (client && c !== client) continue;
    const rp = join(qbBase, c, 'report.md');
    if (existsSync(rp)) { checked++; violations.push(...auditReportMd(readFileSync(rp, 'utf8'), `query-bank/${c}/report.md`)); }
  }
  log(`evidence-audit: ${checked} artifact(s) across ${clients.length} client(s) — ${violations.length} violation(s)`);
  for (const v of violations.slice(0, 25)) log(`  ✗ ${v.file} · ${v.where} — ${v.why}`);
  return { ok: violations.length === 0, checked, clients: clients.length, violations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = evidenceAudit({ client: process.argv[2] || null });
  process.exit(r.ok ? 0 : 1);
}
