// seo-bot · content/score — the Content Score (0–100), Surfer/Frase/Clearscope-grade.
//
// Given a draft (markdown/HTML/plain) and the corpus term ranges from terms.mjs, we:
//   1) count each recommended term in the draft and mark it under / in-range / over,
//   2) compute a weighted term-coverage score (terms weighted by their corpus TF-IDF),
//   3) score STRUCTURAL conformance vs the competitor distribution (word count, heading
//      count, schema present, images/tables),
//   4) score PER-LOCATION signal placement (title / H1 / Hn / body / alt / anchor counts)
//      for the primary term — where a term appears matters, not just how often.
// The three roll up into a single 0–100 with a per-term and per-location breakdown the
// scorer→fix helper (optimize.mjs) turns into proposals.
//
// This is a *quality* score, NOT the anti-slop publish gate — gates.mjs stays the binary
// authority on grounding/compliance. A draft can score 95 here and still be blocked by a
// failing hard gate; both must pass. Pure, deterministic, zero deps.

import { tokenize } from './terms.mjs';

/** Count non-overlapping occurrences of an n-gram in a token stream. */
function countTerm(tokens, term) {
  const parts = term.split(' ');
  if (parts.length === 1) {
    let c = 0; for (const t of tokens) if (t === parts[0]) c++; return c;
  }
  let c = 0;
  for (let i = 0; i + parts.length <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < parts.length; j++) if (tokens[i + j] !== parts[j]) { ok = false; break; }
    if (ok) { c++; i += parts.length - 1; }
  }
  return c;
}

/** Pull location-aware fields from a draft string (markdown OR HTML). */
export function parseDraftSignals(draft = '') {
  const text = String(draft);
  // HTML title / H1 / headings
  const htmlTitle = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const htmlH1 = [...text.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => strip(m[1]));
  const htmlHn = [...text.matchAll(/<h([2-6])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => strip(m[2]));
  const alts = [...text.matchAll(/<img[^>]*\balt\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
  const anchors = [...text.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => strip(m[1]));
  // Markdown headings (# .. ######) and md links
  const mdHeads = [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => ({ level: m[1].length, text: m[2].trim() }));
  const mdLinks = [...text.matchAll(/\[([^\]]+)\]\([^)]+\)/g)].map((m) => m[1]);
  // First markdown H1 (# ) acts as title surrogate when no <title>
  const mdH1 = mdHeads.filter((h) => h.level === 1).map((h) => h.text);
  const mdHn = mdHeads.filter((h) => h.level >= 2).map((h) => h.text);

  const title = strip(htmlTitle) || mdH1[0] || '';
  const h1 = htmlH1.length ? htmlH1 : mdH1;
  const hn = [...htmlHn, ...mdHn];
  const anchorTexts = [...anchors, ...mdLinks];

  // Body = everything minus tags (plain visible text)
  const body = strip(text);
  // Strip fenced code blocks (``` ... ```) and inline code spans (` ... `) before
  // testing for "@type" so a JSON-LD example in a code block doesn't produce a
  // false-positive hasSchema signal. The application/ld+json test is left on the
  // raw text because a real <script type="application/ld+json"> tag is always
  // outside any code fence, and stripping it first would still pass that branch.
  const textNoCode = text
    .replace(/```[\s\S]*?```/g, '')   // fenced code blocks (``` … ```)
    .replace(/`[^`\n]+`/g, '');        // inline code spans
  const hasSchema = /application\/ld\+json/i.test(text) || /"@type"\s*:/.test(textNoCode);
  const tables = (text.match(/<table\b/gi) || []).length + (text.match(/^\s*\|.+\|\s*$/gm) || []).length > 0 ? 1 : 0;
  const images = (text.match(/<img\b/gi) || []).length + (text.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;

  return { title, h1, hn, body, alts, anchorTexts, hasSchema, tables, images,
    bodyTokens: tokenize(body), titleTokens: tokenize(title), h1Tokens: tokenize(h1.join(' ')),
    hnTokens: tokenize(hn.join(' ')), altTokens: tokenize(alts.join(' ')), anchorTokens: tokenize(anchorTexts.join(' ')) };
}

const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Mean of a numeric array. */
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

/**
 * Score a draft against extracted terms + the corpus.
 * @param {string} draft draft text (markdown/HTML/plain)
 * @param {{terms:[...], docCount, query}} terms  output of extractTerms()
 * @param {{cfg?:object, corpus?:object, primaryTerm?:string}} [opts]
 *   corpus (optional) tightens structural targets to the real competitor distribution.
 * @returns {{ score, components:{coverage,structure,placement}, termTable, structure, placement, stats }}
 */
export function scoreContent(draft, terms, { cfg, corpus, primaryTerm } = {}) {
  const sig = parseDraftSignals(draft);
  const termList = terms?.terms || [];
  const tokens = sig.bodyTokens;
  const draftWords = tokens.length;

  // ---- 1) TERM COVERAGE (weighted by TF-IDF weight) ----
  const termTable = [];
  let wSum = 0, wEarned = 0;
  for (const t of termList) {
    const count = countTerm(tokens, t.term);
    const { min, max } = t.recommended;
    let state, credit;
    if (count >= min && count <= max) { state = 'in-range'; credit = 1; }
    else if (count > max) { state = 'over'; credit = 0.7; }          // stuffing — partial credit, flagged
    else if (count > 0) { state = 'under'; credit = count / Math.max(1, min) * 0.6; } // some credit for partial
    else { state = 'missing'; credit = 0; }
    const w = t.weight || 0.01;
    wSum += w; wEarned += w * credit;
    termTable.push({ term: t.term, n: t.n, count, recommended: t.recommended, state, weight: w,
      delta: count < min ? min - count : count > max ? max - count : 0 });
  }
  const coverage = wSum ? wEarned / wSum : 0;

  // ---- 2) STRUCTURAL CONFORMANCE vs competitor distribution ----
  const docs = corpus?.docs || [];
  const compWordCounts = docs.map((d) => d.words || 0).filter(Boolean);
  const compHeadingCounts = docs.map((d) => (d.headings || []).length).filter((n) => n != null);
  const targetWords = compWordCounts.length ? median(compWordCounts) : (cfg?.audit?.minWords || 600);
  const targetHeadings = compHeadingCounts.length ? Math.round(median(compHeadingCounts)) : 6;
  const headingCount = sig.h1.length + sig.hn.length;

  // word count: full credit within [0.8×, 1.4×] of target; ramp outside.
  const wcRatio = targetWords ? draftWords / targetWords : 1;
  const wordScore = wcRatio >= 0.8 && wcRatio <= 1.4 ? 1 : wcRatio < 0.8 ? Math.max(0, wcRatio / 0.8) : Math.max(0.4, 1.4 / wcRatio);
  const headingScore = targetHeadings ? Math.min(1, headingCount / Math.max(1, targetHeadings)) : (headingCount >= 3 ? 1 : headingCount / 3);
  const schemaScore = sig.hasSchema ? 1 : 0;
  const mediaScore = (sig.tables ? 0.5 : 0) + (sig.images > 0 ? 0.5 : 0);
  const structure = round01(0.4 * wordScore + 0.3 * headingScore + 0.2 * schemaScore + 0.1 * mediaScore);

  // ---- 3) PER-LOCATION SIGNAL PLACEMENT (primary term) ----
  const primary = primaryTerm || terms?.query || (termList[0] && termList[0].term) || '';
  const pTok = tokenize(primary).filter(Boolean);
  const inTitle = pTok.length ? countTerm(sig.titleTokens, pTok.join(' ')) > 0 : false;
  const inH1 = pTok.length ? countTerm(sig.h1Tokens, pTok.join(' ')) > 0 : false;
  const inHn = pTok.length ? countTerm(sig.hnTokens, pTok.join(' ')) > 0 : false;
  const inBody = pTok.length ? countTerm(tokens, pTok.join(' ')) : 0;
  const altCovered = sig.alts.length ? sig.alts.filter((a) => a).length / sig.alts.length : 0;
  const anchorCovered = sig.anchorTexts.length && pTok.length ? sig.anchorTexts.filter((a) => { const at = tokenize(a); return pTok.some((t) => at.includes(t)); }).length / sig.anchorTexts.length : 0; // fraction of anchors containing the primary term (was avg tokens/anchor)
  // Weighted: title 30, H1 25, body-presence 20, Hn 15, alt 5, anchor 5
  const placementRaw = 0.30 * (inTitle ? 1 : 0) + 0.25 * (inH1 ? 1 : 0) + 0.20 * (inBody > 0 ? 1 : 0)
    + 0.15 * (inHn ? 1 : 0) + 0.05 * altCovered + 0.05 * anchorCovered;
  const placement = round01(placementRaw);

  // ---- ROLL-UP ---- coverage 55 · structure 25 · placement 20
  // Clamp to [0, 100] to guard against any floating-point overshoot in components.
  const score = Math.min(100, Math.max(0, Math.round(coverage * 55 + structure * 25 + placement * 20)));

  const missing = termTable.filter((t) => t.state === 'missing').length;
  const under = termTable.filter((t) => t.state === 'under').length;
  const over = termTable.filter((t) => t.state === 'over').length;

  return {
    score,
    components: { coverage: round01(coverage), structure, placement },
    termTable,
    structure: { draftWords, targetWords: Math.round(targetWords), wcRatio: round01(wcRatio), headingCount, targetHeadings, hasSchema: sig.hasSchema, images: sig.images, hasTable: !!sig.tables, wordScore: round01(wordScore), headingScore: round01(headingScore) },
    placement: { primary, inTitle, inH1, inHn, inBodyCount: inBody, altCovered: round01(altCovered), anchorCovered: round01(anchorCovered) },
    stats: { termsScored: termTable.length, inRange: termTable.length - missing - under - over, missing, under, over },
  };
}

function round01(x) { return Math.round(x * 1000) / 1000; }
