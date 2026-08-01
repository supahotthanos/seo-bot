// seo-bot · outcomes — the Rank Loop's Layer-2 scoreboard: the ONE longitudinal record of
// whether anything is actually MOVING. Today every outcome source overwrites itself
// (geogrid per-keyword files, run-latest.json, verifier score recomputed, GA4 conversions
// computed then discarded) — so "is SoLV better than last month?" was unanswerable. This
// module appends ONE weekly snapshot row per client to reports/<c>/outcomes.ndjson, renders
// a scoreboard (current vs 4-snapshot baseline vs cfg.goals targets), and flags STALLS
// (north star flat/negative across ≥3 data-carrying snapshots).
//
// Measurement honesty: every missing source is { value:null, reason } — never a zero, never
// invented. The stall detector only counts snapshots that CARRY data for the north star.

import { existsSync, readFileSync, readdirSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';

const readNd = (p) => (existsSync(p) ? readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null; } catch { return null; } };
const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

/** The bettable metric registry: id → accessor over a snapshot row. Single source of truth
 *  for scoreboard deltas AND bet scoring (src/bets.mjs) — a bet may only name these ids. */
export const METRICS = {
  'northStar.solv': { label: 'Map-pack SoLV (mean %)', dir: 'up', get: (s) => s?.northStar?.meanSolv ?? null },
  'northStar.atrp': { label: 'Map-pack ATRP (mean rank)', dir: 'down', get: (s) => s?.northStar?.meanAtrp ?? null },
  'gsc.clicks': { label: 'GSC clicks (28d)', dir: 'up', get: (s) => s?.gsc?.clicks ?? null },
  'gsc.avgPos': { label: 'GSC avg position', dir: 'down', get: (s) => s?.gsc?.avgPos ?? null },
  'gsc.top10': { label: 'GSC pages in top 10', dir: 'up', get: (s) => s?.gsc?.top10 ?? null },
  'panel.appearanceRate': { label: 'AI-panel appearance rate', dir: 'up', get: (s) => s?.panel?.appearanceRate ?? null },
  'aiVis.visibilityPct': { label: 'AI visibility %', dir: 'up', get: (s) => s?.aiVis?.visibilityPct ?? null },
  'ga4.sessions': { label: 'GA4 sessions (28d)', dir: 'up', get: (s) => s?.ga4?.sessions ?? null },
  'ga4.conversions': { label: 'GA4 conversions (28d)', dir: 'up', get: (s) => s?.ga4?.conversions ?? null },
  'verifier.score': { label: 'Readiness score', dir: 'up', get: (s) => s?.verifier ?? null },
  'audit.score': { label: 'Site health score', dir: 'up', get: (s) => s?.audit ?? null },
};

/** PURE: build one snapshot row from gathered sources. Missing source ⇒ null + reason. */
export function buildSnapshot(sources = {}, { at = nowIso() } = {}) {
  const s = sources || {};
  const grids = Array.isArray(s.geogrids) ? s.geogrids.filter((g) => g && Number.isFinite(g.solv)) : [];
  const northStar = grids.length
    ? { keywords: grids.map((g) => ({ keyword: g.keyword, atrp: g.atrp, solv: g.solv, coverage: g.coverage ?? null, ranAt: g.ranAt ?? null })), meanSolv: r2(grids.reduce((a, g) => a + g.solv, 0) / grids.length), meanAtrp: r2(grids.filter((g) => Number.isFinite(g.atrp)).reduce((a, g) => a + g.atrp, 0) / Math.max(1, grids.filter((g) => Number.isFinite(g.atrp)).length)) }
    : { keywords: [], meanSolv: null, meanAtrp: null, reason: 'no geo-grid runs on disk — run `geogrid <client>` for the north-star baseline' };

  let gsc = null;
  if (s.gsc?.enabled && Array.isArray(s.gsc.pages)) {
    let clicks = 0, impressions = 0, posW = 0, top3 = 0, top10 = 0;
    for (const p of s.gsc.pages) {
      clicks += p.clicks || 0; impressions += p.impressions || 0;
      if (Number.isFinite(p.position)) { posW += p.position * (p.impressions || 0); if (p.position <= 3) top3++; if (p.position <= 10) top10++; }
    }
    gsc = { clicks, impressions, avgPos: impressions ? r2(posW / impressions) : null, top3, top10, pages: s.gsc.pages.length };
  } else gsc = { clicks: null, reason: s.gsc?.note || 'GSC not enabled/pulled' };

  const sov = s.panelSov?.overall;
  const panel = (sov && Number.isFinite(sov.appearanceRate))
    ? { appearanceRate: r2(sov.appearanceRate), ci: sov.ci ?? null, n: sov.n ?? sov.observations ?? null }
    : { appearanceRate: null, reason: 'no query-bank observations for this client yet' };

  const aiVis = (s.aiVisRow && Number.isFinite(Number(s.aiVisRow.visibility_pct)))
    ? { visibilityPct: Number(s.aiVisRow.visibility_pct), citedPct: Number.isFinite(Number(s.aiVisRow.cited_pct)) ? Number(s.aiVisRow.cited_pct) : null, engine: s.aiVisRow.engine ?? null, date: s.aiVisRow.date ?? null }
    : { visibilityPct: null, reason: 'no ai-visibility trend rows yet (`measure <client>`)' };

  const ga4 = s.ga4?.enabled
    ? { sessions: s.ga4.sessions ?? null, aiSessions: s.ga4.aiSessions ?? null, conversions: s.ga4.totalConversions ?? null }
    : { sessions: null, reason: s.ga4?.note || 'GA4 not connected' };

  return {
    at, week: Math.floor(Date.parse(at) / (7 * 86400000)),
    northStar, gsc, panel, aiVis, ga4,
    verifier: Number.isFinite(s.verifierScore) ? s.verifierScore : null,
    audit: Number.isFinite(s.auditScore) ? s.auditScore : null,
  };
}

/** All geogrid latest scores on disk (one entry per keyword file). */
export function readGeogrids(client) {
  try {
    const dir = join(ROOT, 'reports', client);
    return readdirSync(dir).filter((n) => /^geogrid-.*\.json$/.test(n)).map((n) => {
      const j = readJson(join(dir, n));
      return j?.score ? { keyword: j.keyword || n, atrp: j.score.atrp ?? null, solv: j.score.solv ?? null, coverage: j.score.coverage ?? null, ranAt: j.ranAt || null } : null;
    }).filter(Boolean);
  } catch { return []; }
}

/** Gather sources live (each fail-soft) and append the weekly row. One row per ISO week —
 *  a second run in the same week refreshes nothing (idempotent ticks, no double-count). */
export async function snapshotOutcomes(cfg, { log = () => {}, sources = null, at = nowIso() } = {}) {
  const dir = join(ROOT, 'reports', cfg.name);
  const ledgerPath = join(dir, 'outcomes.ndjson');
  const week = Math.floor(Date.parse(at) / (7 * 86400000));
  if (readNd(ledgerPath).some((r) => r.week === week)) return { appended: false, note: 'snapshot already taken this week (idempotent)' };

  let s = sources;
  if (!s) {
    s = { geogrids: readGeogrids(cfg.name) };
    try { const { pullGSC } = await import('./gsc.mjs'); s.gsc = await pullGSC(cfg, { log: () => {} }); } catch (e) { s.gsc = { enabled: false, note: String(e.message || e).slice(0, 80) }; }
    try {
      const obs = readNd(join(ROOT, 'reports', 'query-bank', cfg.name, 'observations.ndjson'));
      if (obs.length) { const { shareOfVoice } = await import('./measure/query-bank-analytics.mjs'); s.panelSov = shareOfVoice(obs, cfg.brand); }
    } catch { /* panel absent */ }
    try {
      const trendPath = [join(dir, 'ai-visibility', 'trend.csv'), join(ROOT, 'data', 'ai-visibility', 'trend.csv')].find((p) => existsSync(p));
      if (trendPath) {
        const lines = readFileSync(trendPath, 'utf-8').trim().split('\n');
        const head = lines[0].split(',');
        const last = lines[lines.length - 1].split(',');
        if (lines.length > 1) s.aiVisRow = Object.fromEntries(head.map((h, i) => [h, last[i]]));
      }
    } catch { /* trend absent */ }
    try { const { ga4Report } = await import('./data/ga4.mjs'); const g = await ga4Report(cfg, { log: () => {} }); s.ga4 = g.enabled ? { enabled: true, sessions: (g.rows || []).reduce((a, r) => a + (r.sessions || 0), 0), aiSessions: g.aiSessions ?? null, totalConversions: g.totalConversions ?? null } : g; } catch (e) { s.ga4 = { enabled: false, note: String(e.message || e).slice(0, 80) }; }
    const runLatest = readJson(join(dir, 'run-latest.json'));
    s.verifierScore = runLatest?.progressScore;
    s.auditScore = runLatest?.auditScore;
  }
  const row = buildSnapshot(s, { at });
  mkdirSync(dir, { recursive: true });
  appendFileSync(ledgerPath, JSON.stringify(row) + '\n');
  log(`  outcomes: snapshot appended (solv ${row.northStar.meanSolv ?? 'n/a'} · clicks ${row.gsc.clicks ?? 'n/a'} · panel ${row.panel.appearanceRate ?? 'n/a'})`);
  return { appended: true, row };
}

export function readSnapshots(client) { return readNd(join(ROOT, 'reports', client, 'outcomes.ndjson')); }

/** PURE: scoreboard = latest vs baseline (mean of up-to-4 prior data-carrying rows) vs targets.
 *  Stall: north-star metric non-improving across the last 3 data-carrying snapshots. */
export function buildScoreboard(snapshots = [], { goals = {} } = {}) {
  const rows = Array.isArray(snapshots) ? snapshots : [];
  const latest = rows[rows.length - 1] || null;
  if (!latest) return { ready: false, reason: 'no snapshots yet — the first weekly run creates one', metrics: [], stalled: false };
  const targets = Array.isArray(goals.targets) ? goals.targets : [];
  const metrics = [];
  for (const [id, m] of Object.entries(METRICS)) {
    const cur = m.get(latest);
    const priorVals = rows.slice(0, -1).map((r) => m.get(r)).filter((v) => Number.isFinite(v)).slice(-4);
    const baseline = priorVals.length ? r2(priorVals.reduce((a, b) => a + b, 0) / priorVals.length) : null;
    const delta = Number.isFinite(cur) && Number.isFinite(baseline) ? r2(cur - baseline) : null;
    const improving = delta === null ? null : (m.dir === 'up' ? delta > 0 : delta < 0);
    const target = targets.find((t) => t.metric === id) || null;
    const targetMet = target && Number.isFinite(cur) ? (target.op === '<=' ? cur <= target.value : cur >= target.value) : null;
    metrics.push({ id, label: m.label, dir: m.dir, current: Number.isFinite(cur) ? cur : null, baseline, delta, improving, target: target ? { ...target, met: targetMet } : null });
  }
  // Stall detector on the north star (map-pack SoLV): last 3 data-carrying snapshots non-improving.
  const nsId = goals.northStar === 'map-pack' || !goals.northStar ? 'northStar.solv' : goals.northStar;
  const ns = METRICS[nsId] || METRICS['northStar.solv'];
  const series = rows.map((r) => ns.get(r)).filter((v) => Number.isFinite(v));
  let stalled = false;
  if (series.length >= 3) {
    const last3 = series.slice(-3);
    const step = (a, b) => (ns.dir === 'up' ? b - a : a - b); // positive = improving
    stalled = step(last3[0], last3[1]) <= 0 && step(last3[1], last3[2]) <= 0;
  }
  return { ready: true, at: latest.at, northStar: nsId, metrics, stalled, snapshots: rows.length, stallNote: stalled ? `north star (${ns.label}) non-improving across the last 3 measured snapshots — strategy attention needed` : null };
}

export function renderScoreboardMd(sb = {}, { brand = '' } = {}) {
  if (!sb.ready) return `# Scoreboard — ${brand}\n\n_${sb.reason}_\n`;
  const arrow = (m) => (m.improving === null ? '·' : m.improving ? '▲' : '▼');
  return [
    `# Scoreboard — ${brand}`, `${String(sb.at).slice(0, 10)} · ${sb.snapshots} snapshot(s) · north star: ${sb.northStar}${sb.stalled ? ' · **⚠ STALLED**' : ''}`, '',
    '| metric | now | baseline(≤4wk) | Δ | target |',
    '|---|---|---|---|---|',
    ...sb.metrics.map((m) => `| ${m.label} | ${m.current ?? '—'} | ${m.baseline ?? '—'} | ${arrow(m)} ${m.delta ?? ''} | ${m.target ? `${m.target.op} ${m.target.value} by ${m.target.by || '—'} ${m.target.met === null ? '' : m.target.met ? '✅' : '✗'}` : '—'} |`),
    '', sb.stallNote ? `> ⚠ ${sb.stallNote}` : '', '',
    '_Null = source not measured yet (never zero). Baseline = mean of up to 4 prior data-carrying snapshots._',
  ].join('\n');
}

/** Build + persist scoreboard.{json,md}; escalate once on a NEW stall (dedupe via escalate's 24h + flag file). */
export async function scoreboard(cfg, { log = () => {}, escalateImpl = null } = {}) {
  const sb = buildScoreboard(readSnapshots(cfg.name), { goals: cfg.goals || {} });
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'scoreboard.json'), JSON.stringify({ client: cfg.name, brand: cfg.brand, ...sb }, null, 2));
  writeFileSync(join(dir, 'scoreboard.md'), renderScoreboardMd(sb, { brand: cfg.brand }));
  if (sb.stalled) {
    try {
      const esc = escalateImpl || (await import('./escalate.mjs')).escalate;
      await esc(cfg, { severity: 'warning', area: 'outcomes', title: `North star STALLED — ${cfg.name}`, detail: sb.stallNote }, { log });
    } catch { /* the scoreboard is the record; escalation is a mirror */ }
  }
  log(`  scoreboard: ${sb.ready ? `${sb.metrics.filter((m) => m.improving === true).length}▲ ${sb.metrics.filter((m) => m.improving === false).length}▼${sb.stalled ? ' · ⚠ STALLED' : ''}` : sb.reason}`);
  return sb;
}
