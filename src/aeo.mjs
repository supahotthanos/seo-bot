// seo-bot · aeo — answer-engine optimization rules as FUNCTIONS decide.mjs can call.
//
// We do NOT edit rules.mjs. Instead we expose AEO audit + proposer functions that
// the orchestrator / decide.mjs can invoke, returning the SAME proposal shape the
// rest of the pipeline uses (so priority.mjs, tasks.mjs, apply/* all work unchanged).
//
// What it enforces (D1/D2 evidence):
//  1) ANSWER CAPSULE — a self-contained 40-60 word direct answer in the first ~30%
//     of body text (44.2% of LLM citations come from the first 30% — Position Digital).
//  2) CITABILITY CEILING — declarative answer sentences ≤17 words. The 42,971-citation
//     reverse-engineering study found ZERO cited sentences over 17 words; median 10.
//  3) QUESTION HEADINGS — H2/H3 phrased as real queries (each maps to a fan-out
//     sub-query; question-based headings show large citation lift for small domains).
//  4) GEO METHOD SCORE — reward inline statistics (+34.2%), quotations (+43.8%), and
//     cited sources (+29.0%) per the Princeton GEO paper (KDD 2024); penalize keyword
//     stuffing (-7.8%) and promotional tone (negative AI-citation correlate).
//
// LLM use mirrors decide.mjs (optional, never invents facts): the proposer asks the
// model to TIGHTEN the page's own first paragraph into a ≤17-word-sentence capsule;
// the deterministic path still emits an actionable proposal. Med-spa legal rules are
// NOT touched here (they live in rules.mjs, flag-only) — AEO is structural, safe.

import { countWords } from './util.mjs';
import { splitSentences } from './passage.mjs';

// Hedge / compound tokens that bloat a sentence past the citable ceiling.
const HEDGES = /\b(however|generally|typically|usually|in most cases|it depends|may|might|could|approximately|roughly|tends? to|that said|in addition|furthermore|moreover|on the other hand)\b/gi;
// Promotional superlatives — negative AI-citation signal (kept in sync with rules.mjs PROMO_TOKENS).
const PROMO = /\b(best|#1|number one|leading|ultimate|amazing|revolutionary|world[- ]class|premier|unmatched|unrivaled|guaranteed|cutting[- ]edge|state[- ]of[- ]the[- ]art|top[- ]rated|finest|luxurious|exclusive)\b/gi;
const QUESTION_RE = /\b(how|what|why|when|where|which|who|is|are|can|does|do|should)\b.*\?|\?\s*$/i;
// A "statistic": a number with a unit/context (not a bare list index).
const STAT_RE = /\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(%|percent|mg|ml|units?|sessions?|minutes?|hours?|days?|weeks?|months?|years?|dollars?)\b|\b\d[\d,]*(?:\.\d+)?\s?(?:to|-|–)\s?\$?\d/gi;
// A quotation (curly or straight, ≥3 words) or an attributed claim.
const QUOTE_RE = /["“][^"”]{12,}["”]|\baccording to\b|\bstudies? (show|found|suggest)\b|\bresearch (shows|found)\b/gi;
// An inline cited source (a link or a named authority).
const CITE_RE = /\b(fda|nih|pubmed|aad|asds|american (board|society|academy)|journal of|clinical (trial|study)|jama|\.gov|\.edu)\b/gi;

const CAPSULE_MIN = 40, CAPSULE_MAX = 60; // self-contained answer-capsule word window
const SENT_CEILING = 17;                  // hard citability ceiling (D2: zero cited > 17 words)
const FIRST_REGION = 0.30;                // capsule must sit in the first 30% of body
const READ_WINDOW_CHARS = 5000;           // ChatGPT Deep Research first-read cap: ~5-6k chars of
                                          // linearized SOURCE-ORDER body, head discarded — content
                                          // past it may never be read (Peec AI log forensics, Jun 2026).
                                          // FIRST_REGION is relative; this is the ABSOLUTE cap long
                                          // pages blow even when the capsule is "in the first 30%".

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

/** Split a paragraph into sentences (delegates to passage.splitSentences for abbreviation-safe splitting). */
function sentences(text) {
  return splitSentences(text);
}

/**
 * Score a passage of body text for GEO methods (Princeton GEO, KDD 2024).
 * Rewards inline statistics / quotations / cited sources; penalizes keyword stuffing
 * + promo tone. Returns a 0-100 score and the component counts (for transparency).
 */
export function geoScore(text, { entity = '' } = {}) {
  const t = clean(text);
  const words = countWords(t);
  if (!words) return { score: 0, words: 0, stats: 0, quotes: 0, cites: 0, promo: 0, stuffing: 0 };
  const per100 = words / 100;
  const stats = (t.match(STAT_RE) || []).length;
  const quotes = (t.match(QUOTE_RE) || []).length;
  const cites = (t.match(CITE_RE) || []).length;
  const promo = (t.match(PROMO) || []).length;

  // Keyword stuffing: max single-term density (excluding the target entity, which is
  // expected to recur). >4 per 100 words of one non-entity content term = stuffing.
  const ent = new Set(clean(entity).toLowerCase().split(/\s+/).filter(Boolean));
  const freq = new Map();
  for (const w of t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) { if (w.length > 3 && !ent.has(w)) freq.set(w, (freq.get(w) || 0) + 1); }
  const maxDensity = Math.max(0, ...[...freq.values()].map((c) => c / per100));
  const stuffing = maxDensity > 4 ? Math.round(maxDensity) : 0;

  // Weighted by the Princeton lift magnitudes, scaled to a 0-100 readout.
  let score = 50;
  score += Math.min(20, (stats / per100) * 12);   // statistics +34.2% → strongest positive
  score += Math.min(18, (quotes / per100) * 16);   // quotations +43.8%
  score += Math.min(15, (cites / per100) * 14);    // cited sources +29.0%
  score -= Math.min(25, (promo / per100) * 12);    // promo tone — negative
  score -= Math.min(30, stuffing * 4);             // keyword stuffing -7.8% (heavy penalty: also spam-risk)
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, words, stats, quotes, cites, promo, stuffing };
}

/**
 * Audit a parsed page (rules.parsePage output) for AEO defects.
 * Pure analysis; returns structured findings the proposer turns into proposals.
 * @param {object} parsedPage  output of rules.parsePage (title, headings[], answerText, bodyWords, promoHits…)
 * @returns {{url, capsule, ceiling, questionHeadings, geo, findings:[{rule,severity,message,recommendation,evidence}]}}
 */
export function auditAeo(parsedPage = {}) {
  const p = parsedPage;
  const findings = [];
  const f = (rule, severity, message, recommendation, evidence) => findings.push({ rule, severity, message, recommendation, evidence });

  // --- 1) Answer capsule: 40-60 words, in the first 30% of body, self-contained ---
  const answer = clean(p.answerText || '');
  const answerWords = p.answerWords ?? countWords(answer);
  const hasCapsule = answerWords >= CAPSULE_MIN && answerWords <= CAPSULE_MAX;
  // Position proxy: parsePage takes the EARLIEST substantial paragraph, so presence of
  // a too-late capsule can't be measured from parsed signals alone — flag size only.
  if (!answer) f('aeo-answer-capsule', 'high', 'No direct-answer paragraph near the top of the page.', `Open with a self-contained ${CAPSULE_MIN}-${CAPSULE_MAX} word answer to the page's core question (44% of AI citations come from the first 30% of a page).`);
  else if (!hasCapsule) f('aeo-answer-capsule', answerWords < CAPSULE_MIN ? 'medium' : 'high', `Lead answer is ${answerWords} words (target ${CAPSULE_MIN}-${CAPSULE_MAX}).`, `Tighten the opening to a ${CAPSULE_MIN}-${CAPSULE_MAX} word self-contained capsule — long lead paragraphs are not extracted as answer capsules.`, { answerWords });

  // --- 1b) READ WINDOW (absolute, source-order): Deep Research reads a top→bottom linearization
  // of the HTML SOURCE with a ~5-6k char first-read cap and the <head> discarded. A capsule that
  // passes the relative FIRST_REGION check can still sit past the absolute window on long pages
  // (or behind nav/hero bloat that precedes it in source order) and never be read at all.
  // Offset is measured in the SAME normalized space as parsePage's bodyText (fail-quiet: no
  // bodyText or no match → no finding; never guess).
  let offsetChars = null;
  const bodyClean = clean(p.bodyText || '');
  if (answer && bodyClean) {
    const idx = bodyClean.indexOf(answer.slice(0, 80));
    if (idx >= 0) {
      offsetChars = idx;
      if (idx > READ_WINDOW_CHARS) {
        f('aeo-read-window', 'medium', `Answer starts ${idx.toLocaleString()} chars into the body — past the ~${READ_WINDOW_CHARS.toLocaleString()}-char first-read window AI agents fetch.`, `Move the answer capsule earlier in SOURCE ORDER (agents linearize HTML top→bottom, head discarded, ~5-6k char first read — Peec AI Deep Research log forensics). Trim pre-answer content and keep nav late in source (CSS-position it visually; source order is what gets read).`, { offsetChars: idx, readWindow: READ_WINDOW_CHARS, bodyChars: bodyClean.length });
      }
    }
  }

  // --- 2) Citability ceiling: declarative answer sentences ≤17 words ---
  const sents = sentences(answer);
  const overCeiling = sents.filter((s) => countWords(s) > SENT_CEILING);
  if (overCeiling.length) {
    f('aeo-sentence-ceiling', 'medium', `${overCeiling.length} answer sentence(s) exceed ${SENT_CEILING} words (hard citability ceiling).`, `Split into declarative single-claim sentences ≤${SENT_CEILING} words — the 42,971-citation study found ZERO cited sentences over ${SENT_CEILING} words (median 10).`, { longest: Math.max(0, ...sents.map(countWords)), examples: overCeiling.slice(0, 2).map((s) => s.slice(0, 80)) });
  }

  // --- 3) Question-form headings (each maps to a fan-out sub-query) ---
  const headings = (p.headings || []).map((h) => (typeof h === 'string' ? h : h.text)).filter(Boolean);
  const subHeadings = (p.headings || []).filter((h) => (h.level ? h.level >= 2 : true));
  const qHeadings = headings.filter((h) => QUESTION_RE.test(h));
  if ((p.bodyWords || 0) >= 300 && qHeadings.length === 0) {
    f('aeo-question-headings', 'medium', 'No question-form H2/H3 headings.', 'Phrase H2/H3s as real user questions ("How much does {service} cost in {city}?") — each heading maps to a query-fan-out sub-query for retrieval.', { headings: headings.slice(0, 5) });
  }

  // --- 4) GEO method score (statistics / quotations / cited sources vs promo/stuffing) ---
  const geo = geoScore(p.bodyText || p.answerText || '', { entity: (p.h1s && p.h1s[0]) || p.title || '' });
  if ((p.bodyWords || 0) >= 300) {
    if (geo.stats === 0 && geo.cites === 0) f('aeo-geo-evidence', 'medium', 'No inline statistics or cited sources in the body.', 'Add real, sourced statistics and ≥1 named source (FDA/NIH/journal) — statistics +34% and cited sources +29% to AI visibility (Princeton GEO). Never fabricate numbers.', { stats: geo.stats, cites: geo.cites });
    if (geo.stuffing) f('aeo-keyword-stuffing', 'medium', `Keyword stuffing detected (density ${geo.stuffing}/100w).`, 'Reduce repeated keyword density — keyword stuffing is a NEGATIVE AI-citation signal (-7.8%, Princeton GEO) and a spam risk.', { stuffing: geo.stuffing });
    if (geo.promo >= 3) f('aeo-promo-tone', 'low', `Promotional tone (${geo.promo} superlatives) in body.`, 'Replace superlatives with attributed, measured facts — promotional/commodity tone correlates negatively with AI citation.', { promo: geo.promo });
  }

  return {
    url: p.url,
    capsule: { present: !!answer, words: answerWords, inWindow: hasCapsule, offsetChars },
    ceiling: { overCount: overCeiling.length, longest: Math.max(0, ...sents.map(countWords)) },
    questionHeadings: { count: qHeadings.length, total: subHeadings.length },
    geo,
    findings,
  };
}

/** Optional LLM capsule tightener (mirrors decide.mjs: rewrites the page's OWN text only). */
async function llmCapsule(p) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const model = process.env.SEO_BOT_MODEL || 'claude-sonnet-4-6';
    const src = clean(p.answerText || p.bodyText || '').slice(0, 1400);
    const prompt = `Write a ${CAPSULE_MIN}-${CAPSULE_MAX} word direct-answer capsule for the top of this page. RULES: use ONLY facts present in the content below (invent nothing); every sentence must be a declarative single claim of ${SENT_CEILING} words or fewer; name the subject explicitly (no leading "this/it"); no superlatives. Return ONLY the capsule.
PAGE TITLE: ${p.title || ''}
CONTENT: ${src}`;
    const msg = await client.messages.create({ model, max_tokens: 200, system: 'You are an AEO editor. Output ONLY a self-contained answer capsule, grounded strictly in the provided content.', messages: [{ role: 'user', content: prompt }] });
    try { const { recordUsage, getCostContext } = await import('./cost.mjs'); const c = getCostContext(); recordUsage(c.client, model, msg.usage, { tag: 'aeo' }); } catch { /* telemetry only */ }
    return clean(msg.content?.[0]?.text || '') || null;
  } catch { return null; }
}

/**
 * Turn an AEO audit into standard proposal objects (same shape decide.mjs emits).
 * decide.mjs can call this per page and concat into its proposals[]; priority.mjs,
 * tasks.mjs, and the apply adapters then handle them unchanged.
 * @param {object} page  parsed page (rules.parsePage output; must carry .url)
 * @param {object} cfg   client config
 * @returns {Promise<Array<proposal>>}
 */
export async function proposeAeoFixes(page, cfg = {}) {
  const audit = auditAeo(page);
  const proposals = [];
  const a = cfg.audit || {};
  const lo = a.answerWordsMin || CAPSULE_MIN, hi = a.answerWordsMax || CAPSULE_MAX;
  const url = page.url;
  let pid = 0;
  const id = () => `aeo-${++pid}`;

  for (const fnd of audit.findings) {
    // The capsule fix can be LLM-tightened from the page's own text; others are structural guidance.
    if (fnd.rule === 'aeo-answer-capsule') {
      let proposed = null;
      if (process.env.ANTHROPIC_API_KEY) proposed = await llmCapsule(page);
      proposals.push({
        id: id(), type: 'aeo-answer-capsule', page: url, severity: fnd.severity, autoApplicable: false,
        current: (page.answerText || '(none)').slice(0, 160),
        proposed: proposed || `(Add a ${lo}-${hi} word self-contained capsule answering the page's core question, with declarative sentences ≤${SENT_CEILING} words, derived from existing content.)`,
        rationale: fnd.recommendation, evidence: fnd.evidence,
      });
    } else if (fnd.rule === 'aeo-sentence-ceiling') {
      proposals.push({ id: id(), type: 'aeo-sentence-ceiling', page: url, severity: fnd.severity, autoApplicable: false, current: (fnd.evidence?.examples || []).join(' … ') || `${fnd.evidence?.longest || '?'}-word sentence`, proposed: `Split the answer-position sentences into single-claim statements ≤${SENT_CEILING} words.`, rationale: fnd.recommendation, evidence: fnd.evidence });
    } else if (fnd.rule === 'aeo-question-headings') {
      proposals.push({ id: id(), type: 'aeo-question-headings', page: url, severity: fnd.severity, autoApplicable: false, current: '(no question-form headings)', proposed: '("How much does {service} cost in {city}?", "Is {service} safe?", "How long does {service} last?") — each maps to a fan-out sub-query.', rationale: fnd.recommendation, evidence: fnd.evidence });
    } else if (fnd.rule === 'aeo-geo-evidence') {
      proposals.push({ id: id(), type: 'aeo-geo-evidence', page: url, severity: fnd.severity, autoApplicable: false, current: `stats:${audit.geo.stats} cites:${audit.geo.cites}`, proposed: 'Add real, sourced statistics and ≥1 named authority citation (FDA/NIH/journal) into existing sentences — never fabricate numbers or sources.', rationale: fnd.recommendation, evidence: fnd.evidence });
    } else if (fnd.rule === 'aeo-keyword-stuffing' || fnd.rule === 'aeo-promo-tone') {
      proposals.push({ id: id(), type: fnd.rule, page: url, severity: fnd.severity, autoApplicable: false, current: fnd.message, proposed: fnd.recommendation, rationale: fnd.recommendation, evidence: fnd.evidence });
    }
  }
  return proposals;
}
