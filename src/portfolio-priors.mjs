// seo-bot · portfolio-priors — cross-client learning: the compounding asset.
//
// Every client's decisions.ndjson (stats/controller.mjs verdicts) is a record of which
// change-classes actually WON (keep) or LOST (revert) once the locked-horizon z-test /
// DiD / FDR machinery judged them. This module aggregates that history across the whole
// portfolio into ANONYMIZED Beta priors per {changeClass, vertical}:
//
//     alpha = 1 + keeps,   beta = 1 + reverts        (Beta(1,1) = uniform, no history)
//
// try-next / insufficient-data / hold add to NEITHER count — they are non-outcomes (the
// lever was inert or unjudged), not evidence for or against the class. Malformed or
// non-finite rows are SKIPPED fail-closed (and counted), never guessed at.
//
// WHAT PRIORS MAY DO (one-directional dependency — tests enforce it):
//   • seed the bandit's INITIAL Beta(α,β) so first allocations start from portfolio
//     history instead of uniform (seedBandit), and
//   • order experiment NOMINATION so historically-winning classes are tried first
//     (rankByPrior — deterministic posterior-mean comparison, no RNG).
//
// WHAT PRIORS MUST NEVER DO (the hard boundary):
//   • touch lockedHorizonDate / minDays / minImpressions or any verdict input — the
//     verdict layer (stats/feedback.mjs, stats/controller.mjs, stats/guardrails.mjs)
//     never imports this module;
//   • override a guardrail: a breach returns 'rollback' no matter how strong the prior;
//   • grow without bound: capPrior clamps the effective prior sample (default 20) so
//     live data always overrides history within a normal experiment horizon.
//
// ANONYMIZATION: output records are {changeClass, vertical, keeps, reverts, n} ONLY —
// no client names, no URLs, no page paths. A derived changeClass that looks like a path
// or URL is rejected (fail-closed) rather than leaked.

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadConfig } from './config.mjs';
import { nowIso } from './util.mjs';
import { MAP_PACK_METRIC, isMapPackClass } from './geogrid.mjs';

/** Decisions that are real outcomes vs non-outcomes. Anything else is malformed (fail-closed). */
const OUTCOME = new Set(['keep', 'revert']);
const NON_OUTCOME = new Set(['try-next', 'insufficient-data', 'insufficient', 'hold', 'no-effect']);

/** Effective prior sample cap: live data must always be able to override history. */
export const DEFAULT_MAX_PRIOR_STRENGTH = 20;

/**
 * Derive the change-class of a decisions.ndjson row. Sources, in order: explicit
 * `changeClass`, proposal `type`, experiment `variantField`, the `taskKey` prefix
 * ("<type>:<page>"). Anything that looks like a URL or page path is REJECTED — a
 * change-class is a short token like "meta" / "title" / "jsonld", and letting a path
 * through would leak page identity into the anonymized output (fail-closed).
 * @returns {string|null}
 */
export function extractChangeClass(row) {
  if (!row || typeof row !== 'object') return null;
  const candidates = [row.changeClass, row.type, row.variantField];
  if (typeof row.taskKey === 'string' && row.taskKey.includes(':')) candidates.push(row.taskKey.split(':')[0]);
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const s = c.trim();
    if (!s) continue;
    // Anonymization guard: refuse anything path/URL/domain-shaped (would leak page identity).
    // Dotted TYPE tokens like "schema.entity-graph" are fine — only hostname-shaped values
    // ("secretclinic.com") are rejected.
    if (s.includes('/') || s.includes('\\') || /\s/.test(s) || /https?:/i.test(s)) return null;
    if (/^(?:[a-z0-9-]+\.)+[a-z]{2,6}$/i.test(s)) return null; // domain-shaped
    if (s.length > 64) return null;
    return s;
  }
  return null;
}

/**
 * Classify a row: 'keep' | 'revert' | 'neutral' (non-outcome) | null (malformed → skip).
 * Fail-closed: an unknown decision string, a non-string decision, or a PRESENT numeric
 * field that is not a finite number (corrupt import) makes the row malformed — it is
 * skipped and counted, never coerced into an outcome.
 */
export function classifyRow(row) {
  if (!row || typeof row !== 'object' || typeof row.decision !== 'string') return null;
  for (const k of ['pValue', 'relEffectPct', 'days']) {
    if (row[k] != null && (typeof row[k] !== 'number' || !Number.isFinite(row[k]))) return null;
  }
  if (OUTCOME.has(row.decision)) return row.decision;
  if (NON_OUTCOME.has(row.decision)) return 'neutral';
  return null; // unknown decision string — fail closed
}

/** Default vertical lookup: the client's config (reports/<client> ↔ config/<client>.json). Unknown → 'unknown'. */
function defaultVerticalOf(client) {
  try { return loadConfig(client).vertical || 'unknown'; } catch { return 'unknown'; }
}

/**
 * Scan reports/<client>/decisions.ndjson across the whole portfolio and aggregate
 * keep/revert outcomes BY {changeClass, vertical}. Output is fully anonymized:
 * each prior is {changeClass, vertical, keeps, reverts, n} with n = keeps + reverts.
 *
 * @param {string} [reportsRoot]  defaults to <ROOT>/reports
 * @param {{verticalOf?: (client:string)=>string}} [opts]  vertical resolver (injectable for tests)
 * @returns {{builtAt, clients, rowsScanned, outcomes, nonOutcomes,
 *            skipped:{malformed:number, noChangeClass:number}, priors:Array}}
 */
export function buildPriors(reportsRoot = join(ROOT, 'reports'), { verticalOf = defaultVerticalOf } = {}) {
  const agg = new Map(); // `${changeClass}\u0000${vertical}` → {changeClass, vertical, keeps, reverts}
  let clients = 0, rowsScanned = 0, outcomes = 0, nonOutcomes = 0, malformed = 0, noChangeClass = 0, mapPack = 0;

  let dirs = [];
  try {
    dirs = readdirSync(reportsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
      .map((d) => d.name);
  } catch { dirs = []; } // no reports root yet → empty priors, not a crash

  for (const client of dirs) {
    const f = join(reportsRoot, client, 'decisions.ndjson');
    if (!existsSync(f)) continue;
    clients++;
    let vertical = 'unknown';
    try { vertical = String(verticalOf(client) || 'unknown'); } catch { vertical = 'unknown'; }
    if (/[/\\]/.test(vertical) || /https?:/i.test(vertical)) vertical = 'unknown'; // never let a path-shaped value leak

    for (const line of readFileSync(f, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      rowsScanned++;
      let row = null;
      try { row = JSON.parse(line); } catch { malformed++; continue; } // unparseable → skip, counted
      const kind = classifyRow(row);
      if (kind === null) { malformed++; continue; }
      if (kind === 'neutral') { nonOutcomes++; continue; } // not an outcome — adds to NEITHER count
      const changeClass = extractChangeClass(row);
      if (!changeClass) { noChangeClass++; continue; } // outcome we can't attribute → skip, counted
      // MAP-PACK exclusion: local change-classes are judged on the geo-grid, not organic —
      // any keep/revert booked for them against organic data is a wrong-metric verdict and
      // must never accrue prior mass (it would feed the bandit + nomination ordering).
      // Skipped fail-closed AND counted; they rejoin once a real geo-grid path exists.
      if (row.measure?.metric === MAP_PACK_METRIC || isMapPackClass(changeClass)) { mapPack++; continue; }
      outcomes++;
      const key = `${changeClass}\u0000${vertical}`;
      const rec = agg.get(key) || { changeClass, vertical, keeps: 0, reverts: 0 };
      if (kind === 'keep') rec.keeps++; else rec.reverts++;
      agg.set(key, rec);
    }
  }

  const priors = [...agg.values()]
    .map((r) => ({ changeClass: r.changeClass, vertical: r.vertical, keeps: r.keeps, reverts: r.reverts, n: r.keeps + r.reverts }))
    .sort((a, b) => b.n - a.n || a.changeClass.localeCompare(b.changeClass) || a.vertical.localeCompare(b.vertical));

  return { builtAt: nowIso(), clients, rowsScanned, outcomes, nonOutcomes, skipped: { malformed, noChangeClass, mapPack }, priors };
}

/**
 * Convert one prior record to a Beta(α,β) with the EFFECTIVE PRIOR SAMPLE capped at
 * maxStrength, preserving the mean. α = 1+keeps, β = 1+reverts; if α+β > maxStrength both
 * are scaled by maxStrength/(α+β). The cap is the guarantee that live data can always
 * override history: after ~maxStrength real observations the posterior is data-dominated.
 * Malformed prior → uniform Beta(1,1) (fail-closed: no history, not fake history).
 * @returns {{alpha:number, beta:number, strength:number, capped:boolean}}
 */
export function capPrior(prior, maxStrength = DEFAULT_MAX_PRIOR_STRENGTH) {
  const keeps = prior && typeof prior.keeps === 'number' && Number.isFinite(prior.keeps) && prior.keeps >= 0 ? prior.keeps : null;
  const reverts = prior && typeof prior.reverts === 'number' && Number.isFinite(prior.reverts) && prior.reverts >= 0 ? prior.reverts : null;
  if (keeps === null || reverts === null) return { alpha: 1, beta: 1, strength: 2, capped: false, reason: 'malformed prior — uniform Beta(1,1) (fail-closed)' };
  const max = Number.isFinite(maxStrength) && maxStrength >= 2 ? maxStrength : DEFAULT_MAX_PRIOR_STRENGTH;
  const alpha = 1 + keeps, beta = 1 + reverts;
  const strength = alpha + beta;
  if (strength <= max) return { alpha, beta, strength, capped: false };
  const scale = max / strength;
  return { alpha: alpha * scale, beta: beta * scale, strength: max, capped: true };
}

/** Index priors for lookup: exact {changeClass, vertical}, plus a pooled per-class fallback. */
function indexPriors(priors = []) {
  const exact = new Map(); const pooled = new Map();
  for (const p of Array.isArray(priors) ? priors : []) {
    if (!p || typeof p.changeClass !== 'string') continue;
    exact.set(`${p.changeClass}\u0000${p.vertical ?? 'unknown'}`, p);
    const agg = pooled.get(p.changeClass) || { changeClass: p.changeClass, vertical: '*', keeps: 0, reverts: 0 };
    agg.keeps += Number.isFinite(p.keeps) ? p.keeps : 0;
    agg.reverts += Number.isFinite(p.reverts) ? p.reverts : 0;
    pooled.set(p.changeClass, agg);
  }
  return { exact, pooled };
}

/** Find the prior for a change-class: exact vertical match first, else pooled across verticals. */
export function priorFor(priors, changeClass, { vertical = null } = {}) {
  if (typeof changeClass !== 'string' || !changeClass) return null;
  const { exact, pooled } = indexPriors(priors);
  if (vertical != null) {
    const hit = exact.get(`${changeClass}\u0000${vertical}`);
    if (hit) return hit;
  }
  return pooled.get(changeClass) || null;
}

/**
 * Seed a bandit state's arms with capped portfolio priors. INITIAL ALLOCATION ONLY:
 * the seeded fields are exactly the Beta α/β that stats/bandit.mjs posterior() reads —
 * nothing else on the arm or state is created or modified (no horizon fields, no
 * minDays/minImpressions, no observed counts). Non-mutating: returns a new state.
 * Arms are matched by arm.changeClass (fallback arm.id); no matching prior → arm
 * untouched (stays uniform Beta(1,1) via posterior()'s `?? 1` defaults).
 *
 * @param {Array|{arms:Array}} banditState  arms as stats/bandit.mjs understands them
 * @param {Array} priors  buildPriors().priors
 * @param {{vertical?:string, maxStrength?:number}} [opts]
 */
export function seedBandit(banditState, priors, { vertical = null, maxStrength = DEFAULT_MAX_PRIOR_STRENGTH } = {}) {
  const arms = Array.isArray(banditState) ? banditState : (banditState && Array.isArray(banditState.arms) ? banditState.arms : []);
  const seeded = arms.map((arm) => {
    const cls = typeof arm?.changeClass === 'string' ? arm.changeClass : (typeof arm?.id === 'string' ? arm.id : null);
    const p = cls ? priorFor(priors, cls, { vertical }) : null;
    if (!p) return { ...arm };
    const { alpha, beta } = capPrior(p, maxStrength);
    return { ...arm, alpha, beta }; // ONLY α/β — the whole surface priors are allowed to touch
  });
  return Array.isArray(banditState) ? seeded : { ...banditState, arms: seeded };
}

/**
 * Deterministic nomination ordering: sort change-classes by capped-prior posterior MEAN
 * (α/(α+β)), descending — a pure mean comparison, no RNG (Thompson sampling stays inside
 * the live bandit; ordering the backlog must be reproducible). Classes with no history
 * sit at the uniform mean 0.5. Ties break on larger n (more evidence first), then name.
 *
 * @param {string[]} changeClasses
 * @param {Array} priors
 * @param {{vertical?:string, maxStrength?:number}} [opts]
 * @returns {Array<{changeClass:string, mean:number, n:number, alpha:number, beta:number}>}
 */
export function rankByPrior(changeClasses = [], priors = [], { vertical = null, maxStrength = DEFAULT_MAX_PRIOR_STRENGTH } = {}) {
  const rows = [];
  for (const cls of Array.isArray(changeClasses) ? changeClasses : []) {
    if (typeof cls !== 'string' || !cls) continue;
    const p = priorFor(priors, cls, { vertical });
    const { alpha, beta } = capPrior(p || {}, maxStrength); // no prior → malformed path → uniform Beta(1,1)
    rows.push({ changeClass: cls, mean: alpha / (alpha + beta), n: p ? (p.keeps + p.reverts) : 0, alpha, beta });
  }
  return rows.sort((a, b) => b.mean - a.mean || b.n - a.n || a.changeClass.localeCompare(b.changeClass));
}

/** Human-readable md summary (anonymized — same fields as priors.json, nothing more). */
export function renderPriorsMd(result) {
  const L = [];
  L.push(`# Portfolio priors — cross-client change-class history`);
  L.push('');
  L.push(`Built ${result.builtAt} · ${result.clients} client ledger(s) · ${result.rowsScanned} rows scanned`);
  L.push(`Outcomes: ${result.outcomes} (keep/revert) · non-outcomes: ${result.nonOutcomes} (try-next/insufficient/hold — add to neither)`);
  L.push(`Skipped fail-closed: ${result.skipped.malformed} malformed · ${result.skipped.noChangeClass} without a change-class · ${result.skipped.mapPack ?? 0} map-pack-judged (wrong metric for priors)`);
  L.push('');
  L.push(`Priors seed the bandit's INITIAL allocation and nomination ORDER only. They never touch`);
  L.push(`locked horizons, minimum-data gates, or guardrails — a breach rolls back regardless of history.`);
  L.push('');
  L.push('| changeClass | vertical | keeps | reverts | n | prior mean (capped) |');
  L.push('|---|---|---:|---:|---:|---:|');
  for (const p of result.priors) {
    const { alpha, beta } = capPrior(p);
    L.push(`| ${p.changeClass} | ${p.vertical} | ${p.keeps} | ${p.reverts} | ${p.n} | ${(alpha / (alpha + beta)).toFixed(3)} |`);
  }
  if (!result.priors.length) L.push('| _(no keep/revert history yet)_ | | | | | |');
  return L.join('\n');
}

/**
 * CLI shell: `priors [--rebuild]`. Writes reports/_portfolio/priors.json + priors.md.
 * Without --rebuild an existing priors.json is loaded and summarized; --rebuild rescans
 * every client ledger. Read-only over client data; writes only the anonymized rollup.
 */
export async function runPriors({ log = () => {}, rebuild = false, reportsRoot = join(ROOT, 'reports') } = {}) {
  const outDir = join(reportsRoot, '_portfolio');
  const jsonPath = join(outDir, 'priors.json');
  let result = null;
  if (!rebuild && existsSync(jsonPath)) {
    try { result = JSON.parse(readFileSync(jsonPath, 'utf-8')); log(`  loaded cached priors (${jsonPath}) — pass --rebuild to rescan`); } catch { result = null; } // corrupt cache → rebuild (fail-closed)
  }
  if (!result || !Array.isArray(result.priors)) {
    result = buildPriors(reportsRoot);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(result, null, 2));
    writeFileSync(join(outDir, 'priors.md'), renderPriorsMd(result));
    log(`  rebuilt priors from ${result.clients} client ledger(s) → ${jsonPath} (+ priors.md)`);
  }
  log(`  ${result.priors.length} {changeClass, vertical} prior(s) · ${result.outcomes ?? '?'} outcomes · skipped ${result.skipped?.malformed ?? 0} malformed / ${result.skipped?.noChangeClass ?? 0} unattributable (fail-closed)`);
  for (const p of result.priors.slice(0, 12)) {
    const { alpha, beta } = capPrior(p);
    log(`    ${String(p.changeClass).padEnd(20)} ${String(p.vertical).padEnd(10)} keeps ${String(p.keeps).padStart(3)} · reverts ${String(p.reverts).padStart(3)} · prior mean ${(alpha / (alpha + beta)).toFixed(3)}`);
  }
  if (!result.priors.length) log('    (no keep/revert history yet — priors stay uniform Beta(1,1); the bandit explores from scratch)');
  return result;
}
