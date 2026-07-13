// seo-bot · policy-promotion — the EARNED widening of the auto-apply lane (E9).
//
// The conservative lane auto-approves only DETERMINISTIC_FIX_TYPES (meta/title).
// This module lets a client config NOMINATE additional change-classes via
// cfg.riskTiers.autoClasses — but a nomination alone NEVER widens the lane.
// A class is promoted only when the per-client stats decisions ledger
// (reports/<client>/decisions.ndjson, written by the stats controller after
// locked-horizon judgement) proves it: ZERO 'revert' verdicts AND >= 5 'keep'
// verdicts for that class. Config is a request; history is the authority.
//
// Hard gates (YMYL/legal, high-risk paths, severity ceiling, high-traffic tier)
// live ABOVE the class list in policy.mjs decidePolicy — they queue a proposal
// before the class lane is even consulted, so a force-listed GLP-1 edit still
// queues. Nothing here writes config or applies changes: the output is a human
// PROMOTION WORKSHEET (which classes qualify today, with their history) that an
// operator reads before editing cfg.riskTiers.autoClasses by hand.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IRREVERSIBLE } from './integrity.mjs';
import { MAP_PACK_METRIC, isMapPackClass } from './geogrid.mjs';

/** Verdicts the stats controller emits; anything else in a ledger row is noise. */
const VALID_DECISIONS = new Set(['keep', 'revert', 'try-next', 'insufficient-data']);

/** Minimum proven wins before a class may join the auto lane. */
export const MIN_KEEPS_FOR_PROMOTION = 5;

/**
 * Change-classes that may NEVER enter the auto-apply lane, no matter how good their
 * ledger history looks: index-affecting (robots/noindex — one bad auto-write deindexes a
 * live page), redirects/301 (irreversible), visible-text (h1/headings — cloaking surface
 * on the edge lane), and everything guardIrreversible covers (disavow / IA-restructure /
 * delete-page / canonical-merge). decisions.ndjson is an UNAUTHENTICATED local file —
 * history can be earned or forged — so classes whose blast radius is deindexing or an
 * irreversible change stay human forever (fail-closed).
 */
export const PROMOTION_INELIGIBLE = new Set([
  'robots', 'robots-noindex', 'noindex', 'index',
  'redirect', 'redirect-301', '301',
  'h1', 'h2', 'h3', 'heading', 'headings',
  ...IRREVERSIBLE, // 301-redirect / disavow / ia-restructure / delete-page / canonical-merge / noindex
]);

/**
 * Is this change-class hard-excluded from the promotion lane? Checks the exact class,
 * its leading token (so 'robots-noindex' / 'h1-missing' / 'redirect-chain' are caught),
 * an embedded noindex/robots/redirect/301 token, and the map-pack tag (local-* classes
 * are judged on the geo-grid, never on the organic history the ledger holds).
 * Fail-closed: a missing/blank class is ineligible.
 */
export function isPromotionIneligible(changeClass) {
  if (typeof changeClass !== 'string' || !changeClass.trim()) return true; // fail closed
  const s = changeClass.trim().toLowerCase();
  if (PROMOTION_INELIGIBLE.has(s)) return true;
  const head = s.split(/[.\-_:/\s]/).filter(Boolean)[0] || '';
  if (PROMOTION_INELIGIBLE.has(head)) return true;
  // Boundary class matches the token-split above ([.\-_:/\s]) so 'page/robots' and
  // 'foo robots' cannot slip past on a '/' or whitespace boundary (fail closed).
  if (/(^|[.\-_:/\s])(noindex|robots|redirect|301)([.\-_:/\s]|$)/.test(s)) return true;
  if (isMapPackClass(s)) return true;
  return false;
}

/** Ledger rows that belong to one change-class (typed rows or taskKey-prefixed rows).
 *  Rows measure-tagged map-pack are EXCLUDED regardless of their type/taskKey: those are
 *  judged on the geo-grid, never on the organic ledger — a forged/mislabeled map-pack row
 *  must not count toward keeps (belt to match feedback.mjs's no-keep-booked suspenders). */
function rowsForClass(changeClass, decisionsHistory) {
  return decisionsHistory.filter((d) =>
    d && typeof d === 'object' && VALID_DECISIONS.has(d.decision) &&
    !(d.measure && d.measure.metric === MAP_PACK_METRIC) &&
    (d.type === changeClass || String(d.taskKey || '').startsWith(`${changeClass}:`)));
}

/**
 * May this change-class be auto-promoted into the auto-apply lane?
 * Requires: a well-formed class name, a real (array) history, ZERO reverts, and
 * >= minKeeps 'keep' verdicts for the class. Everything malformed fails CLOSED.
 * @param {string} changeClass  proposal.type (e.g. 'canonical', 'img-alt')
 * @param {Array}  decisionsHistory  rows from decisions.ndjson (see policy.loadStatsDecisions)
 * @returns {{ok:boolean, keeps:number, reverts:number, total:number, reason:string}}
 */
export function canAutoPromote(changeClass, decisionsHistory = [], { minKeeps = MIN_KEEPS_FOR_PROMOTION } = {}) {
  if (typeof changeClass !== 'string' || !changeClass.trim()) {
    return { ok: false, keeps: 0, reverts: 0, total: 0, reason: 'invalid change-class (fail closed)' };
  }
  if (isPromotionIneligible(changeClass)) {
    return { ok: false, keeps: 0, reverts: 0, total: 0, reason: `class "${changeClass}" is PROMOTION-INELIGIBLE (index-affecting / redirect / visible-text / irreversible / map-pack-judged) — never auto-promotes, regardless of ledger history (fail closed)` };
  }
  if (!Array.isArray(decisionsHistory)) {
    return { ok: false, keeps: 0, reverts: 0, total: 0, reason: 'decisions history is not an array (fail closed)' };
  }
  const min = Number.isFinite(minKeeps) && minKeeps > 0 ? minKeeps : MIN_KEEPS_FOR_PROMOTION;
  const rows = rowsForClass(changeClass, decisionsHistory);
  const keeps = rows.filter((d) => d.decision === 'keep').length;
  const reverts = rows.filter((d) => d.decision === 'revert').length;
  if (!rows.length) return { ok: false, keeps: 0, reverts: 0, total: 0, reason: 'no prior outcome data for this class' };
  if (reverts > 0) return { ok: false, keeps, reverts, total: rows.length, reason: `${reverts} revert(s) on record — class disqualified` };
  if (keeps < min) return { ok: false, keeps, reverts, total: rows.length, reason: `only ${keeps} keep(s) (< ${min} required)` };
  return { ok: true, keeps, reverts, total: rows.length, reason: `${keeps} keeps, 0 reverts across ${rows.length} judged changes` };
}

/** All change-classes that appear in a ledger (typed rows + taskKey prefixes). */
export function classesInHistory(decisionsHistory = []) {
  const set = new Set();
  for (const d of Array.isArray(decisionsHistory) ? decisionsHistory : []) {
    if (!d || typeof d !== 'object') continue;
    if (typeof d.type === 'string' && d.type) set.add(d.type);
    else if (typeof d.taskKey === 'string' && d.taskKey.includes(':')) set.add(d.taskKey.split(':')[0]);
  }
  return [...set].sort();
}

/**
 * Build the promotion worksheet: which classes qualify TODAY, with their history.
 * Pure — no config writes, ever. The operator edits cfg.riskTiers.autoClasses by hand.
 * @returns {{rows:Array<{changeClass, ok, keeps, reverts, total, reason}>, qualified:string[], markdown:string}}
 */
export function promotionWorksheet(decisionsHistory = [], candidateClasses = []) {
  const cands = [...new Set([...(Array.isArray(candidateClasses) ? candidateClasses : []), ...classesInHistory(decisionsHistory)])]
    .filter((c) => typeof c === 'string' && c.trim()).sort();
  const rows = cands.map((changeClass) => ({ changeClass, ...canAutoPromote(changeClass, decisionsHistory) }));
  const qualified = rows.filter((r) => r.ok).map((r) => r.changeClass);
  const L = ['# Auto-lane promotion worksheet', '',
    `Rule: a change-class joins \`riskTiers.autoClasses\` ONLY with **0 reverts AND >= ${MIN_KEEPS_FOR_PROMOTION} keeps** in decisions.ndjson.`,
    'Listing a class in config does nothing without this history (policy re-checks at decision time).',
    'Hard gates (YMYL/GLP-1, high-risk paths, severity ceiling, high-traffic tier) queue regardless of class.', '',
    '| change-class | keeps | reverts | judged | qualifies today | why |',
    '|---|---:|---:|---:|:---:|---|'];
  for (const r of rows) L.push(`| ${r.changeClass} | ${r.keeps} | ${r.reverts} | ${r.total} | ${r.ok ? '✅ YES' : '✗ no'} | ${r.reason} |`);
  if (!rows.length) L.push('| _(no judged classes yet)_ | — | — | — | ✗ no | run the stats controller first |');
  L.push('', qualified.length
    ? `**Qualified today:** ${qualified.join(', ')} — a HUMAN may now add these to \`riskTiers.autoClasses\`. This worksheet never edits config.`
    : '**No class qualifies today.** Keep shipping human-reviewed fixes; the ledger builds the case.');
  return { rows, qualified, markdown: L.join('\n') };
}

/**
 * IO shell: read the client's decisions ledger, write reports/<client>/promotion-worksheet.md.
 * Emits the worksheet INSTEAD of auto-editing config (human gates every widening).
 */
export async function writePromotionWorksheet(cfg, { candidateClasses = [], log = () => {} } = {}) {
  const { ROOT } = await import('./config.mjs');
  const f = join(ROOT, 'reports', cfg.name, 'decisions.ndjson');
  let history = [];
  if (existsSync(f)) {
    try {
      history = readFileSync(f, 'utf-8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { history = []; } // unreadable ledger → empty history → nothing qualifies (fail closed)
  }
  const ws = promotionWorksheet(history, candidateClasses);
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'promotion-worksheet.md');
  writeFileSync(out, ws.markdown);
  log(`  Promotion worksheet: ${ws.qualified.length} class(es) qualify today (${ws.qualified.join(', ') || 'none'})`);
  log(`  → ${out}`);
  return { ...ws, path: out };
}
