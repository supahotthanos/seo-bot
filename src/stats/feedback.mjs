// seo-bot · stats/feedback — turn the significance math into decisions over real
// GSC data. Two jobs:
//   1. decideChange(): given before/after (and optionally a control set), decide
//      keep / revert / no-effect / insufficient-data for an applied change.
//   2. scanClient(): pull GSC and flag pages whose CTR moved SIGNIFICANTLY between
//      the last window and the prior window — candidates the bot should act on.
// The whole point: never act on noise; only move when it's statistically real, and
// pause judgement during a confirmed core update (caller passes coreUpdateActive).

import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso } from '../util.mjs';
import { twoProportionZTest, enoughData, differenceInDifferences, minSampleForProportion, bhReject } from './significance.mjs';
import { MAP_PACK_METRIC } from '../geogrid.mjs';

const DEFAULTS = { minImpressions: 1000, minDays: 14, alpha: 0.05, minPracticalEffectPct: 5, fdrQ: 0.05 };

/**
 * Decide what to do about an applied change. Four-way verdict:
 *   keep | revert | try-next | insufficient-data  (+ hold during a core update).
 * Guards baked in: locked-horizon (no peeking), practical-effect floor (stat≠practical),
 * FDR result passthrough (opts.fdrPassed), DiD confound control, and a guardrail-KPI
 * override (a CTR "win" that significantly tanks conversions becomes a REVERT).
 *
 * @param guardrail optional { before:{conversions,sessions}, after:{...} } primary KPI
 * @param measure   optional { metric } tag stamped by the proposer (src/local/factors.mjs
 *                  stamps map-pack) — the metric SOURCE this change must be judged on
 * @param geogridSeries optional geo-grid ATRP/SoLV series for map-pack changes
 */
export function decideChange({ before, after, control = null, days = 0, guardrail = null, measure = null, geogridSeries = null, opts = {} }) {
  const o = { ...DEFAULTS, ...opts };
  // MAP-PACK tag (E1): local change-classes are judged on geo-grid ATRP/SoLV, NEVER on the
  // organic GSC series this function tests — proximity makes organic the wrong denominator,
  // so an unrelated organic co-movement must never book a keep/revert for a local class into
  // decisions.ndjson (which feeds buildPriors + canAutoPromote). Fail closed: no geo-grid
  // judgment path exists yet, so map-pack changes NEVER produce a keep/revert here.
  if (measure && measure.metric === MAP_PACK_METRIC) {
    return {
      decision: 'insufficient-data',
      reason: geogridSeries
        ? 'map-pack change: a geo-grid series was supplied but no geo-grid judgment path exists yet — refusing to judge on organic GSC data (fail closed, no keep/revert booked)'
        : 'wrong metric source — map-pack changes need a geogrid ATRP/SoLV series, not organic GSC CTR (proximity makes organic the wrong denominator); no keep/revert booked (fail closed)',
    };
  }
  if (o.coreUpdateActive) return { decision: 'hold', reason: 'core/spam update in progress — judgement paused +7d (confound)' };
  if (o.lockedHorizonDate && o.nowMs && o.nowMs < Date.parse(o.lockedHorizonDate)) {
    return { decision: 'insufficient-data', reason: `locked horizon not reached (${o.lockedHorizonDate}) — judging once at horizon avoids peeking (false-positive inflation 5%→30-40%)` };
  }
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return { decision: 'insufficient-data', reason: 'missing before/after data — cannot judge' };
  if (!enoughData({ impressions: after?.impressions || 0, days }, o)) {
    const baseCtr = before?.impressions ? before.clicks / before.impressions : 0.05;
    return { decision: 'insufficient-data', reason: `not enough data (need >= ${o.minImpressions} impressions AND >= ${o.minDays} days) — cluster pages or wait; this is NOT "no effect"`, haveImpressions: after?.impressions || 0, haveDays: days, sampleToDetect10pctLift: minSampleForProportion(baseCtr || 0.05, 0.1) };
  }
  const test = twoProportionZTest(before.clicks, before.impressions, after.clicks, after.impressions, o.alpha);
  const did = control?.before && control?.after ? differenceInDifferences(before, after, control.before, control.after) : null;
  const pv = did ? did.pValue : test.pValue;
  // A degenerate BEFORE arm (0 / NaN / Infinity impressions — e.g. a page newly gaining traffic)
  // makes the z-test return {ok:false} with no p-value. Return clean insufficient-data instead of
  // crashing on pv.toFixed — one bad GSC row must never abort the whole batch (controller/scanClient).
  if (!Number.isFinite(pv)) return { decision: 'insufficient-data', reason: 'degenerate before/after sample (0 or non-finite) — cannot compute a p-value', test, did };
  const baseSig = (did ? did.significant : test.significant) && (o.fdrPassed !== false);
  const dir = did ? (did.didCtr > 0 ? 'up' : 'down') : test.direction;
  const ctrB = before.impressions ? before.clicks / before.impressions : 0;
  const ctrA = after.impressions ? after.clicks / after.impressions : 0;
  const relEffectPct = ctrB ? (Math.abs(ctrA - ctrB) / ctrB) * 100 : 0;
  const practical = relEffectPct >= o.minPracticalEffectPct;

  let decision, reason;
  if (!baseSig) { decision = 'try-next'; reason = `not significant (p=${pv.toFixed(3)}${did ? ', DiD-controlled' : ''}${o.fdrPassed === false ? ', failed FDR' : ''}) → lever inert, advance the backlog`; }
  else if (!practical) { decision = 'try-next'; reason = `significant but only ${relEffectPct.toFixed(1)}% (< ${o.minPracticalEffectPct}% practical floor) → not worth churn, advance backlog`; }
  else if (dir === 'up') { decision = 'keep'; reason = `significant + practical improvement (+${relEffectPct.toFixed(1)}%, p=${pv.toFixed(3)})`; }
  else { decision = 'revert'; reason = `significant regression (p=${pv.toFixed(3)}) → revert`; }

  // Guardrail override: a CTR keep that significantly harms the primary KPI → revert.
  if (decision === 'keep' && guardrail?.before && guardrail?.after) {
    const g = twoProportionZTest(guardrail.before.conversions, guardrail.before.sessions, guardrail.after.conversions, guardrail.after.sessions, o.alpha);
    if (g.ok && g.significant && g.direction === 'down') { decision = 'revert'; reason += ` — BUT the primary KPI (conversions) dropped significantly (p=${g.pValue.toFixed(3)}) → REVERT`; }
    else if (!g.ok) { decision = 'insufficient-data'; reason += ' — BUT the supplied conversion guardrail was degenerate (can\'t verify the primary KPI) → hold.'; }
  }
  return { decision, reason, test, did, relEffectPct };
}

/** Append a change to the per-client ledger (apply adapters can call this). */
export function logChange(client, change) {
  const dir = join(ROOT, 'reports', client);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'changes.jsonl'), JSON.stringify({ ...change, at: change.at || nowIso() }) + '\n');
}

export function readChanges(client) {
  const f = join(ROOT, 'reports', client, 'changes.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf-8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * Scan a client's GSC for pages whose CTR moved SIGNIFICANTLY between the last
 * `windowDays` and the prior `windowDays`. Flags significant drops (act now) and
 * significant gains (lock in / replicate). Requires gsc.enabled; degrades to a note.
 */
export async function scanClient(cfg, { log = () => {}, windowDays = 28, opts = {} } = {}) {
  const o = { ...DEFAULTS, ...opts };
  // Freeze judgement during a confirmed Google core/spam update (confound).
  const { googleUpdates } = await import('../updates.mjs');
  const upd = await googleUpdates({ log });
  if (upd.coreUpdateActive) o.coreUpdateActive = true;
  const { pullGSC } = await import('../gsc.mjs');
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

  // Two real windows: current [now-W .. now-1] vs prior [now-2W .. now-W-1].
  const cur = await pullGSC(cfg, { log, range: { startDate: day(windowDays), endDate: day(1) } });
  if (!cur.enabled) { log(`  stats scan: GSC off (${cur.note}). Connect Google or set gsc.enabled.`); return { enabled: false, note: cur.note }; }
  const prior = await pullGSC(cfg, { range: { startDate: day(2 * windowDays), endDate: day(windowDays + 1) } });

  const norm = (k) => (k || '').replace(/\/$/, '');
  const priorByPage = new Map((prior.pages || []).map((p) => [norm(p.keys?.[0]), p]));
  // Build the whole comparison family first, THEN BH-FDR-correct across it — testing N pages
  // at alpha each manufactures ~N*alpha false "keep"s without this multiple-comparisons gate.
  const fam = [];
  for (const p of (cur.pages || [])) {
    const before = priorByPage.get(norm(p.keys?.[0]));
    if (!before) continue;
    const b = { clicks: before.clicks, impressions: before.impressions };
    const a = { clicks: p.clicks, impressions: p.impressions };
    const t = twoProportionZTest(b.clicks, b.impressions, a.clicks, a.impressions, o.alpha);
    fam.push({ p, b, a, pv: (t.ok && Number.isFinite(t.pValue)) ? t.pValue : 1 });
  }
  const fdr = bhReject(fam.map((f) => f.pv), o.fdrQ); // boolean[] aligned to fam
  const verdicts = [];
  fam.forEach((f, i) => {
    const d = decideChange({ before: f.b, after: f.a, days: windowDays, opts: { ...o, fdrPassed: fdr[i] } });
    verdicts.push({ page: f.p.keys[0], decision: d.decision, reason: d.reason, beforeCtr: f.b.impressions ? +(f.b.clicks / f.b.impressions).toFixed(4) : 0, afterCtr: f.a.impressions ? +(f.a.clicks / f.a.impressions).toFixed(4) : 0, impressions: f.p.impressions });
  });
  verdicts.sort((a, b) => b.impressions - a.impressions);
  const tally = verdicts.reduce((m, v) => { m[v.decision] = (m[v.decision] || 0) + 1; return m; }, {});

  log(`  stats scan: ${verdicts.length} pages compared (last ${windowDays}d vs prior ${windowDays}d) → ${Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(', ') || 'no overlap'}`);
  for (const v of verdicts.filter((x) => x.decision === 'keep' || x.decision === 'revert').slice(0, 8)) log(`    [${v.decision}] ${v.page} — ${v.reason}`);
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'stats-scan.json'), JSON.stringify({ client: cfg.name, ranAt: nowIso(), windowDays, tally, verdicts }, null, 2));
  return { enabled: true, tally, verdicts };
}
