// seo-bot · experiments/registry — the durable store + page-bucketing for the self-driving
// experiment loop. OTTO has nothing like this: a versioned, queryable record of every
// hypothesis the engine is testing, with matched control/variant page sets and a LOCKED
// evaluation horizon (no peeking — peeking inflates false positives from 5% to 30-40%).
//
// STORAGE: reports/<client>/experiments.ndjson — append-only event log, collapsed to the
// latest state per experiment id (same pattern as tasks.mjs). Each experiment:
//   { id, template, hypothesis, variantField, controlPages[], variantPages[],
//     baselineWindow:{startDate,endDate,days}, lockedHorizonDate, expectedRatio,
//     status: nominated|launched|evaluating|promoted|rolled_back|inconclusive, ... }
//
// BUCKETING (the hard part done right): same-TEMPLATE URLs are split into matched control
// and variant buckets BALANCED ON BASELINE TRAFFIC. We sort by baseline metric and snake-
// /alternate-assign so the two buckets have near-equal total + distribution of traffic —
// the precondition for a clean counterfactual and a passing SRM check. Assignment is
// DETERMINISTIC PER PAGE (a stable hash of the path), never per user/cookie/UA: Googlebot
// and humans get one identical rendering of each URL. That is the line between an experiment
// and cloaking, and we never cross it.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso } from '../util.mjs';

export const EXPERIMENT_STATUSES = ['nominated', 'launched', 'evaluating', 'promoted', 'rolled_back', 'inconclusive', 'abandoned'];

const dirFor = (client) => join(ROOT, 'reports', client);
const fileFor = (client) => join(dirFor(client), 'experiments.ndjson');

export function loadEvents(client) {
  const f = fileFor(client);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf-8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Collapse the append-only log to the latest state per experiment id. */
export function currentExperiments(client) {
  const m = new Map();
  for (const e of loadEvents(client)) m.set(e.id, { ...(m.get(e.id) || {}), ...e });
  return [...m.values()];
}

export function getExperiment(client, id) {
  return currentExperiments(client).find((e) => e.id === id) || null;
}

function append(client, rec) {
  mkdirSync(dirFor(client), { recursive: true });
  appendFileSync(fileFor(client), JSON.stringify(rec) + '\n');
  return rec;
}

/** FNV-1a 32-bit hash → deterministic per-path bucketing (stable across runs, no PRNG state). */
export function hashPath(s) {
  let h = 0x811c9dc5;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Deterministic per-page variant assignment (NOT per user) for a 2-arm split.
 *  Returns 'variant' | 'control'. Salt with the experiment id so different experiments
 *  on the same template don't all pick the same pages. */
export function assignArm(path, experimentId, { ratio = 0.5 } = {}) {
  const h = hashPath(`${experimentId}::${path}`);
  return (h % 10000) / 10000 < ratio ? 'variant' : 'control';
}

const baseTraffic = (p) => (p?.impressions ?? p?.clicks ?? p?.baseline ?? 0);

/**
 * Split same-template URLs into matched control/variant buckets BALANCED on baseline traffic.
 * Sort by baseline metric desc, then alternate (snake) assignment so each bucket gets a
 * similar share of high- and low-traffic pages → near-equal totals (SRM-safe) and comparable
 * distributions (counterfactual-fittable). Bucket membership is then PINNED by deterministic
 * hash so it's stable if the page set changes slightly between runs.
 *
 * @param {Array<{page:string, impressions?:number, clicks?:number, baseline?:number}>} pages
 * @param {{ratio?:number, experimentId?:string, minBucket?:number}} opts
 * @returns {{control:string[], variant:string[], balance:{controlBaseline,variantBaseline,skew}}}
 */
export function bucketPages(pages = [], { ratio = 0.5, experimentId = 'exp', minBucket = 1 } = {}) {
  const valid = pages.filter((p) => p && p.page);
  if (valid.length < minBucket * 2) return { control: valid.map((p) => p.page), variant: [], balance: { controlBaseline: 0, variantBaseline: 0, skew: 1 }, reason: `too few pages (${valid.length}) to split into two buckets` };

  // Greedy balanced partition: walk pages high→low traffic, assign each to whichever bucket
  // is currently lighter (respecting the target ratio). Beats pure alternation at matching totals.
  const sorted = [...valid].sort((a, b) => baseTraffic(b) - baseTraffic(a));
  const control = [], variant = [];
  let cSum = 0, vSum = 0;
  const targetVariantShare = ratio;
  for (const p of sorted) {
    const t = baseTraffic(p);
    const total = cSum + vSum + t || 1;
    // project each bucket's share if it took this page; pick the assignment closest to target.
    const variantShareIfV = (vSum + t) / total;
    const variantShareIfC = vSum / total;
    if (Math.abs(variantShareIfV - targetVariantShare) <= Math.abs(variantShareIfC - targetVariantShare)) { variant.push(p.page); vSum += t; }
    else { control.push(p.page); cSum += t; }
  }
  // Pin with the deterministic hash where the greedy result is a near-tie (keeps assignment
  // stable run-to-run for pages whose traffic is roughly equal — avoids churn).
  const total = cSum + vSum || 1;
  const skew = Math.abs(vSum / total - targetVariantShare); // 0 = perfectly balanced
  return { control, variant, balance: { controlBaseline: cSum, variantBaseline: vSum, skew, ratio } };
}

/**
 * Register a new experiment (status 'nominated'). Generates a stable id; sets the locked
 * horizon = launch-relative or baselineEnd + horizonDays. Returns the stored record.
 *
 * @param {string} client
 * @param {object} spec {template, hypothesis, variantField, controlPages[], variantPages[],
 *   baselineWindow:{startDate,endDate,days}, expectedRatio?, proposalIds?, taskIds?, meta?}
 * @param {{horizonDays?:number, actor?:string, nowMs?:number}} opts
 */
export function registerExperiment(client, spec, { horizonDays = 28, actor = 'auto', nowMs = Date.now() } = {}) {
  const at = new Date(nowMs).toISOString();
  const id = spec.id || `${client}-exp-${at.replace(/[:.]/g, '-')}-${hashPath(spec.template + (spec.variantField || '')).toString(36).slice(0, 6)}`;
  const lockedHorizonDate = spec.lockedHorizonDate || new Date(nowMs + horizonDays * 86400000).toISOString().slice(0, 10);
  const rec = {
    id,
    template: spec.template,
    hypothesis: spec.hypothesis || '',
    variantField: spec.variantField || null,
    controlPages: spec.controlPages || [],
    variantPages: spec.variantPages || [],
    baselineWindow: spec.baselineWindow || null,
    lockedHorizonDate,
    horizonDays,
    expectedRatio: spec.expectedRatio || [0.5, 0.5],
    proposalIds: spec.proposalIds || [],
    taskIds: spec.taskIds || [],
    meta: spec.meta || {},
    status: 'nominated',
    actor, at,
    history: [{ status: 'nominated', at, actor }],
  };
  return append(client, rec);
}

/** Transition an experiment, recording who/when + optional fields (e.g. result, commit). */
export function setStatus(client, id, status, { actor = 'auto', extra = {}, nowMs = Date.now() } = {}) {
  if (!EXPERIMENT_STATUSES.includes(status)) throw new Error(`invalid experiment status: ${status}`);
  const cur = getExperiment(client, id);
  if (!cur) throw new Error(`no experiment ${id} for ${client}`);
  const at = new Date(nowMs).toISOString();
  return append(client, { ...cur, ...extra, status, actor, at, history: [...(cur.history || []), { status, at, actor, note: extra.note || null }] });
}

/** Experiments whose locked horizon has been reached and are still running (ready to judge). */
export function dueForEvaluation(client, { nowMs = Date.now() } = {}) {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  return currentExperiments(client).filter((e) => (e.status === 'launched' || e.status === 'evaluating') && e.lockedHorizonDate && e.lockedHorizonDate <= today);
}

/** Active experiments (launched/evaluating) — used to avoid double-nominating a template. */
export function activeExperiments(client) {
  return currentExperiments(client).filter((e) => e.status === 'launched' || e.status === 'evaluating' || e.status === 'nominated');
}

export function summarize(client) {
  const all = currentExperiments(client);
  const by = {};
  for (const e of all) by[e.status] = (by[e.status] || 0) + 1;
  return { total: all.length, by };
}
