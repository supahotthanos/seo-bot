// seo-bot · content/topicmodel — TF-IDF + importance → a MarketMuse-style topic model.
//
// extractTerms gives ranked terms; this layer turns them into a TOPIC MODEL: importance
// scores (normalized), the competitor word-count range (so a draft is judged on depth vs
// the real SERP, not a fixed target), and the missing-subtopics set for a given draft.
//
// It also exports a COVERAGE SOFT-GATE FACTORY (buildCoverageGate) that returns a function
// gates.mjs could call without being edited. The gate is intentionally SOFT and capped to
// avoid keyword-stuffing: it rewards covering important subtopics up to a 2-mention cap
// (MarketMuse's anti-stuffing heuristic) and never rewards going over a term's range.

import { extractTerms } from './terms.mjs';
import { scoreContent, parseDraftSignals } from './score.mjs';

/**
 * Build a topic model from a corpus.
 * @param {object} corpus  buildCorpus() output
 * @param {{maxN?:number, top?:number}} [opts]
 * @returns {{ query, docCount, wordCountRange:{min,median,max}, subtopics:[{term,importance,recommended,df}], terms }}
 *
 * importance = normalized blend of TF-IDF weight and competitor agreement (df/N): a subtopic
 * that many competitors cover deeply is more important than one outlier's pet phrase.
 */
export function buildTopicModel(corpus, { maxN = 3, top = 80 } = {}) {
  const extracted = extractTerms(corpus, { maxN, top });
  const N = extracted.docCount || 1;
  const wc = (corpus?.docs || []).map((d) => d.words || 0).filter(Boolean).sort((a, b) => a - b);
  const wordCountRange = wc.length
    ? { min: wc[0], median: wc[Math.floor(wc.length / 2)], max: wc[wc.length - 1] }
    : { min: 0, median: 0, max: 0 };

  const maxBlend = extracted.terms.reduce((m, t) => Math.max(m, (t.weight || 0) * (1 + t.df / N)), 0) || 1;
  const subtopics = extracted.terms.map((t) => ({
    term: t.term, n: t.n, df: t.df,
    importance: Math.round(((t.weight || 0) * (1 + t.df / N) / maxBlend) * 1000) / 1000,
    recommended: t.recommended,
  })).sort((a, b) => b.importance - a.importance);

  return { query: extracted.query, docCount: N, wordCountRange, subtopics, terms: extracted };
}

/**
 * Which important subtopics does this draft NOT cover (or under-cover)?
 * @returns {{ covered, total, missing:[{term,importance,recommended,count}], coverageScore }}
 *   coverageScore is importance-weighted, 2-mention-capped (anti-stuffing).
 */
export function missingSubtopics(model, draft, { importanceFloor = 0.15 } = {}) {
  const sig = parseDraftSignals(draft);
  const r = scoreContent(draft, model.terms, { corpus: { docs: [] }, primaryTerm: model.query });
  const byTerm = new Map(r.termTable.map((t) => [t.term, t.count]));
  const important = model.subtopics.filter((s) => s.importance >= importanceFloor);
  let wSum = 0, wEarned = 0; const missing = [];
  for (const s of important) {
    const count = byTerm.get(s.term) || 0;
    const cap = Math.min(2, s.recommended.min || 1); // MarketMuse: ~2 mentions is "covered"
    const credit = Math.min(1, count / cap);
    wSum += s.importance; wEarned += s.importance * credit;
    if (count === 0) missing.push({ term: s.term, importance: s.importance, recommended: s.recommended, count });
  }
  return {
    covered: important.length - missing.length, total: important.length,
    missing: missing.sort((a, b) => b.importance - a.importance),
    coverageScore: wSum ? Math.round((wEarned / wSum) * 1000) / 1000 : 0,
    wordCount: sig.bodyTokens.length, wordCountRange: model.wordCountRange,
  };
}

/**
 * COVERAGE SOFT-GATE FACTORY. Returns a pure function `(draft) => result` that gates.mjs
 * (or any caller) can invoke WITHOUT importing the corpus machinery or being edited.
 *
 * Wiring intent (do NOT edit gates.mjs in this change): a future one-line hook in
 * scoreContent() can do `const cov = (opts.coverageGate||(()=>null))(draft)` and fold
 * cov.score into a soft component. Until then it stands alone and is unit-testable.
 *
 * @param {object} model buildTopicModel() output
 * @param {{threshold?:number, importanceFloor?:number}} [opts]
 * @returns {(draft:string)=> { pass, score, threshold, covered, total, missing, wordCount, wordCountRange, note }}
 */
export function buildCoverageGate(model, { threshold = 0.6, importanceFloor = 0.15 } = {}) {
  return function coverageGate(draft) {
    const m = missingSubtopics(model, draft, { importanceFloor });
    const wcOk = !model.wordCountRange.median || m.wordCount >= model.wordCountRange.median * 0.6;
    const pass = m.coverageScore >= threshold && wcOk;
    return {
      pass, score: m.coverageScore, threshold,
      covered: m.covered, total: m.total,
      missing: m.missing.slice(0, 12).map((x) => x.term),
      wordCount: m.wordCount, wordCountRange: m.wordCountRange,
      note: pass ? 'topic coverage OK (soft)'
        : `covers ${m.covered}/${m.total} important subtopics (${Math.round(m.coverageScore * 100)}% < ${Math.round(threshold * 100)}%)${wcOk ? '' : '; also under depth vs competitors'}`,
    };
  };
}
