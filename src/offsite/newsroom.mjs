// seo-bot · offsite/newsroom — owned-newsroom mirror + wire discipline for press releases.
//
// Encodes research/medspa-ein-aeo-playbook.md ("rules of the box" §5, checklist §4) and
// research/superlative-wires.md: every decent-DR wire bans BARE superlatives in author voice;
// opinions live only inside attributed quotes. The mirror-first + refire rules encode the
// owned-newsroom lever (~18%) and the 4–6-week half-life re-fire cadence — with the June-2026
// fake-refresh guard applied to PR: a re-fire is only real if at least one NUMBER actually
// changed vs the previous body.
//
// This module EVALUATES; it never submits. Wire submission is in the never-automate set —
// a human fires every release. All gates are HARD (no appeal) and machine-readable:
// { ok, action:'fire'|'refuse', reasons:[{gate, detail}] }. Fail-closed: an empty/missing
// field is a refusal, never a pass.

import { existsSync } from 'node:fs';
import { countWords } from '../util.mjs';

// GLP-1 brand names AND ingredient names — categorical reject (EIN weight-loss-ingredient ban;
// FTC NextMed settlement; Lilly/Novo NAD challenges). FLAG/REFUSE only, never rewritten.
export const GLP1_TERMS = ['ozempic', 'wegovy', 'mounjaro', 'zepbound', 'semaglutide', 'tirzepatide'];

const SUPERLATIVE_RE = /(?<![a-z0-9])(best|finest|greatest|premier|leading|top[\s-]?rated|world[\s-]?class|unrivaled|unmatched|number\s+one|award[\s-]?winning|highest[\s-]?rated|top\s+choice)(?![a-z0-9])|#\s?1(?![0-9])/i;

// Banned categories (EIN categorical bans). "Medical weight loss program" (drug-free, no
// efficacy number) is the survivable form and must NOT trip this — we ban weight-loss
// PRODUCTS/ingredients, not the words "weight loss".
const BANNED_CATEGORIES = [
  ['health-supplements', /\bsupplements?\b/i],
  ['weight-loss-products', /\bweight[\s-]?loss\s+(pill|product|drug|injection|shot|supplement|medication|gummies)s?\b|\bfat[\s-]?burners?\b|\bappetite\s+suppressants?\b|\bdiet\s+pills?\b/i],
  ['sexual-enhancement', /\bsexual\s+(enhancement|performance)\b|\blibido\s+(booster|enhanc\w*)\b/i],
  ['online-pharma', /\bonline\s+pharmac(y|ies)\b|\bbuy\b[^.\n]{0,40}\bwithout\s+(a\s+)?prescription\b/i],
];

const CREDENTIAL_RE = /\b(MD|DO|NP-BC|NP|PA-C|RN|APRN|FNP-C|FNP|DNP|MSN|CANS|board-certified|licensed\s+(nurse\s+practitioner|physician|esthetician|aesthetician))\b/;
const NAME_RE = /(Dr\.?\s+)?[A-Z][a-zA-Z'’.-]+\s+[A-Z][a-zA-Z'’.-]+/;

export const REFIRE_MIN_DAYS = 28; // >=4 weeks (half-life ~3–4.5 weeks)
export const REFIRE_MAX_DAYS = 42; // <=6 weeks target cadence; past this, plan a NEW release

const reason = (gate, detail) => ({ gate, detail });

/** Extract quoted spans ("…" or “…”) and whether each is ATTRIBUTED (name near the quote). */
export function extractQuotes(text) {
  const out = [];
  const re = /"([^"]{2,600})"|“([^”]{2,600})”/g;
  let m;
  while ((m = re.exec(text || '')) !== null) {
    const quote = m[1] ?? m[2];
    const after = (text || '').slice(m.index + m[0].length, m.index + m[0].length + 160);
    const before = (text || '').slice(Math.max(0, m.index - 100), m.index);
    const attribRe = /(said|says|added|noted|according\s+to|—|–)\s*(Dr\.?\s+)?[A-Z][a-zA-Z'’.-]+/;
    const attributed = attribRe.test(after) || /(said|says|per|according\s+to)\s+(Dr\.?\s+)?[A-Z][a-zA-Z'’.-]+[^"“]{0,60}$/.test(before);
    out.push({ text: quote, attributed, after, index: m.index });
  }
  return out;
}

/** Author-voice text = full text minus ATTRIBUTED quote spans. Unattributed quotes stay in
 *  (fail closed: an opinion in an unattributed quote is still the author talking). */
export function authorVoice(text) {
  let t = text || '';
  for (const q of extractQuotes(t)) if (q.attributed) t = t.replace(q.text, ' ');
  return t;
}

/** Gate: bare superlative in author voice (title is ALWAYS author voice). */
export function findSuperlativeInAuthorVoice(title, body) {
  const hits = [];
  const tm = (title || '').match(SUPERLATIVE_RE);
  if (tm) hits.push(`title: "${tm[0]}"`);
  const bm = authorVoice(body).match(SUPERLATIVE_RE);
  if (bm) hits.push(`body (author voice): "${bm[0]}"`);
  return hits;
}

/** Gate: banned categories anywhere in title+body. */
export function findBannedCategories(text) {
  const hits = [];
  for (const [cat, re] of BANNED_CATEGORIES) { const m = (text || '').match(re); if (m) hits.push({ category: cat, match: m[0] }); }
  return hits;
}

/** Gate: GLP-1 brand/ingredient names anywhere (quotes included — no loophole). */
export function findGlp1Terms(text) {
  const t = (text || '').toLowerCase();
  return GLP1_TERMS.filter((term) => new RegExp(`(?<![a-z0-9])${term}(?![a-z0-9])`).test(t));
}

/** Gate: prices must be RANGES ("$700–$1,500", "$12 to $18"), never points ("$500"). */
export function findPointPrices(body) {
  let t = body || '';
  // Remove valid ranges first, then any surviving $-amount is a point price.
  const RANGE_RE = /\$\s?\d[\d,]*(\.\d+)?\s*(?:–|—|-|to|through)\s*\$?\s?\d[\d,]*(\.\d+)?/gi;
  t = t.replace(RANGE_RE, ' ');
  return (t.match(/\$\s?\d[\d,]*(\.\d+)?/g) || []).map((s) => s.trim());
}

/** Gate: >=3 hard numbers (digit-bearing tokens) inside the first 30% of the body. */
export function hardNumbersFirstThird(body) {
  const words = (body || '').trim().split(/\s+/).filter(Boolean);
  const firstThird = words.slice(0, Math.ceil(words.length * 0.3));
  return firstThird.filter((w) => /\d/.test(w)).length;
}

/** Gate: >=1 attributed quote from a NAMED, credentialed provider. */
export function hasAttributedProviderQuote(body) {
  for (const q of extractQuotes(body || '')) {
    if (!q.attributed) continue;
    const window = q.after;
    if (NAME_RE.test(window) && CREDENTIAL_RE.test(window)) return true;
  }
  return false;
}

/** Gate: links <= 1 per 100 words (EIN format rule). */
export function linkStats(body) {
  const words = countWords(body || '');
  const links = ((body || '').match(/https?:\/\//g) || []).length;
  const allowed = Math.max(1, Math.floor(words / 100));
  return { words, links, allowed, ok: links <= allowed };
}

/**
 * HARD content gates for one release record { id, title, body, numbers:[{label,value,source}] }.
 * Every reason is machine-readable; there is no appeal path in code.
 */
export function validateRelease(release) {
  const reasons = [];
  const title = release?.title || '';
  const body = release?.body || '';
  if (!release || typeof release !== 'object') return { ok: false, reasons: [reason('empty-release', 'no release record supplied')] };
  if (!title.trim() || !body.trim()) reasons.push(reason('empty-release', 'title and body are both required'));

  const all = `${title}\n${body}`;
  for (const s of findSuperlativeInAuthorVoice(title, body)) reasons.push(reason('superlative-author-voice', `${s} — opinions live only inside attributed quotes`));
  for (const b of findBannedCategories(all)) reasons.push(reason('banned-category', `${b.category}: "${b.match}"`));
  for (const g of findGlp1Terms(all)) reasons.push(reason('glp1-term', `"${g}" — GLP-1 brand/ingredient names are categorically refused (human/legal review only)`));
  for (const p of findPointPrices(body)) reasons.push(reason('point-price', `${p} — prices must be ranges ("$700–$1,500"), never points`));

  if (body.trim()) {
    const n = hardNumbersFirstThird(body);
    if (n < 3) reasons.push(reason('front-load-numbers', `${n} hard number(s) in the first 30% of the body; need >=3 (ranges, series counts, location counts)`));
    if (!hasAttributedProviderQuote(body)) reasons.push(reason('missing-provider-quote', 'need >=1 attributed quote from a NAMED provider with a credential (e.g. "— Jane Doe, NP-BC")'));
    const ls = linkStats(body);
    if (!ls.ok) reasons.push(reason('link-density', `${ls.links} links in ${ls.words} words; max ${ls.allowed} (<=1 per 100 words)`));
  }

  // The numbers ledger is the substantiation record — every number needs a label, a value,
  // and a SOURCE, and must actually appear in the body (no fabricated ledger, no ghost stats).
  const nums = Array.isArray(release?.numbers) ? release.numbers : null;
  if (!nums || !nums.length) reasons.push(reason('numbers-ledger-missing', 'numbers:[{label,value,source}] is required — it is the substantiation + refire-diff record'));
  else {
    for (const num of nums) {
      if (!num || !num.label || num.value === undefined || num.value === null) { reasons.push(reason('number-malformed', `numbers entry missing label/value: ${JSON.stringify(num)}`)); continue; }
      if (!num.source) reasons.push(reason('number-unsourced', `"${num.label}" has no source — unsourced numbers are refused (no fabrication)`));
      const norm = (s) => String(s).replace(/\s+/g, ' ').replace(/[–—]/g, '-');
      if (body && !norm(body).includes(norm(num.value))) reasons.push(reason('number-not-in-body', `"${num.label}" = "${num.value}" does not appear in the body`));
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** Mirror-first: refuse a wire fire unless the owned-newsroom mirror is verifiably published. */
export function checkMirrorFirst(release, { existsFn = existsSync } = {}) {
  const reasons = [];
  if (!release?.mirrorPath) reasons.push(reason('mirror-missing', 'no mirrorPath — publish the owned-newsroom mirror BEFORE any wire fire (mirror-first ordering)'));
  else {
    let published = !!release.mirrorPublishedAt;
    if (!published) { try { published = !!existsFn(release.mirrorPath); } catch { published = false; } }
    if (!published) reasons.push(reason('mirror-not-published', `mirror ${release.mirrorPath} is not published (no mirrorPublishedAt and the file does not exist) — fail closed`));
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Refire eligibility vs the PREVIOUS fired version { body, numbers }:
 *   >=28 days AND <=42 days since the last fire, AND at least one number ACTUALLY changed
 *   (the June-2026 fake-refresh guard applied to PR — re-dating without a real data change
 *   is exactly what the spam update penalized).
 */
export function checkRefire(release, previous, { now = Date.now() } = {}) {
  const reasons = [];
  const fired = Array.isArray(release?.firedAt) ? release.firedAt : [];
  if (!fired.length) return { ok: true, reasons, firstFire: true };

  const stamps = fired.map((d) => Date.parse(d));
  if (stamps.some((t) => !Number.isFinite(t))) return { ok: false, reasons: [reason('bad-fire-date', `unparseable date in firedAt: ${JSON.stringify(fired)} — fail closed`)] };
  const days = (now - Math.max(...stamps)) / 86400000;
  if (days < REFIRE_MIN_DAYS) reasons.push(reason('refire-too-soon', `last fired ${days.toFixed(1)} days ago; minimum cadence is ${REFIRE_MIN_DAYS} days`));
  if (days > REFIRE_MAX_DAYS) reasons.push(reason('refire-window-passed', `last fired ${days.toFixed(1)} days ago (> ${REFIRE_MAX_DAYS}); the half-life is spent — write a NEW release with fresh numbers instead`));

  if (!previous || !Array.isArray(previous.numbers) || !previous.numbers.length) {
    reasons.push(reason('no-previous-version', 'release was fired before but no previous {body, numbers} record exists — cannot verify a real change, fail closed'));
    return { ok: false, reasons };
  }
  const cur = new Map((release.numbers || []).filter((n) => n?.label).map((n) => [n.label, String(n.value)]));
  const prev = new Map(previous.numbers.filter((n) => n?.label).map((n) => [n.label, String(n.value)]));
  let changed = 0;
  for (const [label, value] of cur) { if (!prev.has(label) || prev.get(label) !== value) changed++; }
  if (!cur.size || changed === 0) reasons.push(reason('fake-refresh', 'no number actually changed vs the previous body — re-dating without a real update is refused (June-2026 fake-refresh guard)'));

  return { ok: reasons.length === 0, reasons, daysSinceLastFire: Math.round(days * 10) / 10, changedNumbers: changed };
}

/**
 * The one call the CLI/orchestrator makes per release: content gates + mirror-first +
 * (if previously fired) refire discipline. NEVER submits — returns a verdict for the human.
 */
export function evaluateWireFire(release, { previous = null, now = Date.now(), existsFn = existsSync } = {}) {
  const reasons = [
    ...validateRelease(release).reasons,
    ...checkMirrorFirst(release, { existsFn }).reasons,
    ...checkRefire(release, previous, { now }).reasons,
  ];
  return { id: release?.id ?? null, ok: reasons.length === 0, action: reasons.length ? 'refuse' : 'fire', reasons };
}
