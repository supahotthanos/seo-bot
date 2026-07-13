// seo-bot · local/reviews — review-velocity math + review-language analysis.
// Pure, deterministic, ANALYSIS-ONLY.
//
// Evidence (research/local-ranking-factors-2026.md §1.3, Sterling Sky ground-truth):
//  - the 18-day rule: review-driven rank decays after ~18 days without a new review;
//  - the 10-review threshold: small bump at 9→10, nothing at 10→11;
//  - review JUSTIFICATIONS: reviews that NAME the service create query-matched pack snippets;
//  - review-language mining (Gifford): reuse authentic patient phrasing in copy.
//
// ██ HARD LEGAL LINE (FTC 16 CFR 465 + Google suspension risk) ████████████████████
// This module MEASURES review signals. It exports NO function that composes a review
// request, solicits, gates, incentivizes, or contacts anyone — and never will. The
// test suite asserts the export surface contains none of send/solicit/request/compose/
// contact/outreach/ask. Asking a patient is a HUMAN workflow, outside this codebase.
// ████████████████████████████████████████████████████████████████████████████████
//
// Fail-closed: empty/garbage/non-finite inputs return { ...: null, reason } — never a
// fabricated score, never a throw.

const DAY_MS = 86400000;
export const DECAY_DAYS = 18;      // the Sterling Sky velocity-decay window
export const REVIEW_THRESHOLD = 10; // the Sterling Sky threshold (bump 9→10)

function parseDates(reviewDates, nowMs) {
  if (!Array.isArray(reviewDates) || reviewDates.length === 0) return { error: 'no-review-dates' };
  const ts = [];
  for (const d of reviewDates) {
    const t = typeof d === 'number' ? d : Date.parse(d);
    if (!Number.isFinite(t)) return { error: `unparseable-review-date: ${String(d).slice(0, 40)}` };
    if (t > nowMs + DAY_MS) return { error: 'future-review-date (clock/data problem — fail closed)' };
    ts.push(t);
  }
  return { ts };
}

/**
 * Velocity score with the 18-day decay rule. Each review contributes 2^(-ageDays/18)
 * (a review is worth half its weight every 18 days), so a steady flow beats a burst.
 * Returns { score, reviewsLastWindow, daysSinceLast, stalled, reason:null }
 * or fail-closed { score:null, reason } on empty/garbage/non-finite input.
 */
export function velocityScore(reviewDates, now = Date.now()) {
  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(nowMs)) return { score: null, reason: 'non-finite-now' };
  const p = parseDates(reviewDates, nowMs);
  if (p.error) return { score: null, reason: p.error };
  let score = 0, lastMs = -Infinity, recent = 0;
  for (const t of p.ts) {
    const ageDays = Math.max(0, (nowMs - t) / DAY_MS);
    score += Math.pow(2, -ageDays / DECAY_DAYS);
    if (ageDays <= DECAY_DAYS) recent++;
    if (t > lastMs) lastMs = t;
  }
  const daysSinceLast = (nowMs - lastMs) / DAY_MS;
  return {
    score: Math.round(score * 100) / 100,
    reviewsLastWindow: recent,
    daysSinceLast: Math.round(daysSinceLast * 10) / 10,
    stalled: daysSinceLast > DECAY_DAYS, // past the 18-day window → the velocity component decays
    reason: null,
  };
}

/**
 * Gap to the 10-review threshold. { gap, atThreshold, note, reason:null } or
 * fail-closed { gap:null, reason } on non-finite/negative counts.
 */
export function thresholdGap(count) {
  if (!Number.isFinite(count) || count < 0 || Math.floor(count) !== count) return { gap: null, reason: 'invalid-review-count' };
  if (count >= REVIEW_THRESHOLD) return { gap: 0, atThreshold: true, note: 'Past the 10-review threshold — velocity/recency/justifications now matter more than volume.', reason: null };
  return { gap: REVIEW_THRESHOLD - count, atThreshold: false, note: `${REVIEW_THRESHOLD - count} more real review${REVIEW_THRESHOLD - count === 1 ? '' : 's'} to the 9→10 threshold bump. ANALYSIS ONLY — solicitation is a human workflow (FTC 16 CFR 465).`, reason: null };
}

// Default med-spa service lexicon for justification mining when cfg.services is absent.
const DEFAULT_SERVICE_TERMS = ['botox', 'dysport', 'filler', 'lip filler', 'laser', 'laser hair removal', 'facial', 'hydrafacial', 'microneedling', 'morpheus8', 'coolsculpting', 'chemical peel', 'prp', 'iv therapy', 'semaglutide', 'weight loss'];

const cleanTexts = (reviewTexts) => {
  if (!Array.isArray(reviewTexts)) return null;
  const t = reviewTexts.filter((x) => typeof x === 'string' && x.trim());
  return t.length ? t : null;
};

/**
 * Justification mining (ANALYSIS ONLY): which reviews name a service/keyword — i.e. can
 * Google surface a query-matched justification snippet in the pack? Returns
 * { total, naming, pct, byService:{term:count}, reason:null } or { total:null, reason }.
 */
export function justificationCheck(reviewTexts, services = []) {
  const texts = cleanTexts(reviewTexts);
  if (!texts) return { total: null, reason: 'no-review-texts' };
  const terms = [...new Set([...(Array.isArray(services) ? services : []), ...DEFAULT_SERVICE_TERMS]
    .filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().toLowerCase()))];
  const byService = {};
  let naming = 0;
  for (const raw of texts) {
    const t = raw.toLowerCase();
    let named = false;
    for (const term of terms) {
      if (t.includes(term)) { byService[term] = (byService[term] || 0) + 1; named = true; }
    }
    if (named) naming++;
  }
  return { total: texts.length, naming, pct: Math.round((naming / texts.length) * 100), byService, reason: null };
}

const STOPWORDS = new Set(('a an and are as at be but by for from had has have i i\'m it its me my of on or our so that the they this to was we were with you your they\'re it\'s very really just so much too also am is he she her his him them us out up get got').split(/\s+/));

/**
 * Review-language mining (Gifford): term frequencies from real review text, for reusing
 * AUTHENTIC patient phrasing in copy. { terms:[{term,count}], reason:null } or
 * fail-closed { terms:null, reason }.
 */
export function reviewLanguageTerms(reviewTexts, { top = 25 } = {}) {
  const texts = cleanTexts(reviewTexts);
  if (!texts) return { terms: null, reason: 'no-review-texts' };
  const freq = new Map();
  for (const raw of texts) {
    for (const w of raw.toLowerCase().split(/[^a-z0-9']+/)) {
      if (!w || w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  const terms = [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, Math.max(1, top | 0)).map(([term, count]) => ({ term, count }));
  return { terms, reason: null };
}
