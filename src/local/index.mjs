// seo-bot · local/index — the `local <client>` CLI runner.
// Assesses the client's local map-pack posture against the consolidated 2026 factor
// model (research/local-ranking-factors-2026.md), runs the review-velocity math
// (analysis only), suppresses debunked tactics, and writes
// reports/<client>/local.md + local.json.
//
// Signals come from cfg.local (an object in the client config — the human fills what
// they know from the GBP dashboard; nothing is fetched live here). Missing signals are
// reported as UNKNOWN, never guessed. All proposals are human-applied (GBP is not a
// CMS adapter) and tagged measure:{metric:'map-pack'} → judged on geo-grid ATRP/SoLV.

import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso } from '../util.mjs';
import { FACTORS, DEBUNKED, assessLocal, suppressDebunked } from './factors.mjs';
import { velocityScore, thresholdGap, justificationCheck, reviewLanguageTerms } from './reviews.mjs';

/** Latest geo-grid score for the client, if a grid has been run (fail-soft → null). */
export function latestGeogrid(clientName) {
  try {
    const dir = join(ROOT, 'reports', clientName);
    const files = readdirSync(dir).filter((n) => /^geogrid-.*\.json$/.test(n));
    if (!files.length) return null;
    files.sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
    const j = JSON.parse(readFileSync(join(dir, files[0]), 'utf-8'));
    if (!j || typeof j !== 'object' || !j.score) return null;
    return { file: files[0], ranAt: j.ranAt || null, keyword: j.keyword || null, atrp: j.score.atrp ?? null, solv: j.score.solv ?? null, coverage: j.score.coverage ?? null };
  } catch { return null; }
}

/** Build the signals object from the client config (cfg.local object; booleans gate only). */
export function signalsFromCfg(cfg = {}) {
  const s = (cfg.local && typeof cfg.local === 'object') ? { ...cfg.local } : {};
  // convenience derivations, never overriding explicit signals
  if (s.addressVisible === undefined && typeof s.gbp === 'object' && s.gbp && s.gbp.addressVisible !== undefined) s.addressVisible = s.gbp.addressVisible;
  return s;
}

export async function runLocal(cfg, { log = () => {} } = {}) {
  const signals = signalsFromCfg(cfg);
  const { findings, proposals } = assessLocal(cfg, signals);
  // Self-check every proposal (ours AND any the caller folded in) against the DEBUNKED list.
  const { kept, flagged } = suppressDebunked(proposals);

  // Review math — analysis only (NO solicitation automation exists in this codebase).
  const rv = (signals.reviews && typeof signals.reviews === 'object') ? signals.reviews : {};
  const reviewMath = {
    velocity: Array.isArray(rv.dates) ? velocityScore(rv.dates) : { score: null, reason: 'no review dates supplied (cfg.local.reviews.dates)' },
    threshold: Number.isFinite(rv.count) ? thresholdGap(rv.count) : (Array.isArray(rv.dates) ? thresholdGap(rv.dates.length) : { gap: null, reason: 'no review count supplied' }),
    justifications: Array.isArray(rv.texts) ? justificationCheck(rv.texts, cfg.services || []) : { total: null, reason: 'no review texts supplied (cfg.local.reviews.texts)' },
    language: Array.isArray(rv.texts) ? reviewLanguageTerms(rv.texts) : { terms: null, reason: 'no review texts supplied' },
  };

  const grid = latestGeogrid(cfg.name);
  const ranAt = nowIso();

  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });

  const issues = findings.filter((x) => x.status === 'issue');
  const unknowns = findings.filter((x) => x.status === 'unknown');
  const oks = findings.filter((x) => x.status === 'ok');
  const infos = findings.filter((x) => x.status === 'info');

  const L = [`# Local map-pack assessment — ${cfg.brand}`,
    `${cfg.baseUrl || ''} · ${ranAt}`, '',
    `Model: research/local-ranking-factors-2026.md (Sterling Sky / Whitespark 2026 / SearchLab / Near Media).`,
    `Measurement: map-pack work is judged on geo-grid **ATRP/SoLV** (\`geogrid ${cfg.name}\`), not organic position.`,
    grid ? `Latest grid: ATRP ${grid.atrp} · SoLV ${grid.solv}% · coverage ${grid.coverage}% ("${grid.keyword}", ${grid.ranAt || grid.file})` : `No geo-grid run found yet — run \`geogrid ${cfg.name}\` for the ATRP/SoLV baseline.`, '',
    `**${issues.length} issues · ${unknowns.length} unknown (supply signals in cfg.local) · ${oks.length} ok**`, ''];

  if (issues.length) { L.push('## Issues'); for (const x of issues) L.push(`- **${x.factor}** — ${x.message}`, `  - Fix: ${x.recommendation}`, `  - Evidence: ${x.evidenceTier} · ${x.source}`); L.push(''); }
  if (kept.length) { L.push('## Proposals (human applies — GBP is not a CMS adapter)'); for (const p of kept) L.push(`- [ ] **${p.type}** (${p.severity}) — ${p.proposed}`, `  - Now: ${p.current}`, `  - Why: ${p.rationale}`, `  - Judge on: ${p.measure?.metric}`); L.push(''); }
  if (flagged.length) { L.push('## ⛔ Suppressed (debunked tactics — do NOT do these)'); for (const x of flagged) L.push(`- **${x.debunked}** — ${x.reason} (${x.source})`); L.push(''); }
  if (unknowns.length) { L.push('## Unknown — supply these signals in cfg.local to assess'); for (const x of unknowns) L.push(`- **${x.factor}** — ${x.message}`); L.push(''); }

  L.push('## Review math (ANALYSIS ONLY — solicitation is a human workflow, FTC 16 CFR 465)');
  L.push(`- Velocity (18-day rule): ${reviewMath.velocity.score === null ? `n/a — ${reviewMath.velocity.reason}` : `score ${reviewMath.velocity.score} · ${reviewMath.velocity.reviewsLastWindow} reviews in the last 18d · ${reviewMath.velocity.daysSinceLast}d since last${reviewMath.velocity.stalled ? ' · **STALLED (past the 18-day window)**' : ''}`}`);
  L.push(`- 10-review threshold: ${reviewMath.threshold.gap === null ? `n/a — ${reviewMath.threshold.reason}` : reviewMath.threshold.note}`);
  L.push(`- Justifications: ${reviewMath.justifications.total === null ? `n/a — ${reviewMath.justifications.reason}` : `${reviewMath.justifications.naming}/${reviewMath.justifications.total} reviews (${reviewMath.justifications.pct}%) name a service — query-matched pack snippets`}`);
  if (reviewMath.language.terms) L.push(`- Patient language (reuse authentic phrasing): ${reviewMath.language.terms.slice(0, 10).map((t) => `${t.term}(${t.count})`).join(' · ')}`);
  L.push('', '## Debunked list (never recommended)', ...DEBUNKED.map((d) => `- ~~${d.id}~~ — ${d.reason} (${d.source})`), '',
    '## Stays human', '- Review solicitation of any kind · hours/category/GBP-link changes (bot proposes, human applies) · LSA call handling · suspension/reinstatement.');

  const mdPath = join(dir, 'local.md');
  const jsonPath = join(dir, 'local.json');
  writeFileSync(mdPath, L.join('\n'));
  writeFileSync(jsonPath, JSON.stringify({ client: cfg.name, brand: cfg.brand, ranAt, findings, proposals: kept, suppressed: flagged, reviewMath, geogrid: grid, model: { factors: FACTORS.map(({ id, weight, evidenceTier }) => ({ id, weight, evidenceTier })), debunked: DEBUNKED.map((d) => d.id), source: 'research/local-ranking-factors-2026.md' } }, null, 2));

  log(`\n  Local map-pack — ${cfg.brand}`);
  log(`  ${issues.length} issues · ${unknowns.length} unknown · ${oks.length} ok · ${kept.length} proposals${flagged.length ? ` · ⛔ ${flagged.length} debunked suppressed` : ''}`);
  for (const x of issues) log(`    🔴 ${x.factor}: ${x.message}`);
  for (const x of infos) log(`    ℹ ${x.factor}: ${x.message}`);
  log(`  → ${mdPath}\n`);
  return { findings, proposals: kept, suppressed: flagged, reviewMath, geogrid: grid, mdPath, jsonPath };
}
