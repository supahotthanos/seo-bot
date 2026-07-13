// seo-bot · passage — passage-independence / self-containment linter.
//
// The CHUNK, not the page, is the unit of retrieval AND citation in 2026 answer
// engines (Google AI Mode/AIO, Perplexity, ChatGPT Search). Retrieval embeds
// passages, RRF-fuses them across the query fan-out, and a citation maps to the
// single passage that supports a sentence — so a chunk must survive being ripped
// out of its page. (D1: recursive 400-600 token chunks, ~15% overlap; Vecta
// Feb-2026: recursive 512-token = 69% accuracy vs naive 43-token shards = 54%.)
//
// We chunk the RAW server HTML exactly the way an engine does, then score each
// chunk for INDEPENDENCE: does it open with a dangling anaphora (this/that/it)?
// is the subject entity missing? does it need a prior heading for sense? is it a
// truncated list / mid-sentence fragment? Output rewrite suggestions so every
// chunk reads as a self-contained answer. Pure analysis — no writes, no LLM
// required (the suggestions are deterministic, fact-preserving guidance).

import * as cheerio from 'cheerio';
import { countWords } from './util.mjs';

// ~1 token ≈ 0.75 words (English). 400-600 tokens ≈ 300-450 words; we target ~512
// tokens ≈ 384 words as the chunk size, with ~15% overlap, per the D1 baseline.
const WORDS_PER_TOKEN = 0.75;
const TARGET_TOKENS = 512;
const TARGET_WORDS = Math.round(TARGET_TOKENS * WORDS_PER_TOKEN);   // ~384
const MIN_WORDS = Math.round(400 * WORDS_PER_TOKEN);               // ~300 (400-token floor)
const MAX_WORDS = Math.round(600 * WORDS_PER_TOKEN);               // ~450 (600-token ceiling)
const OVERLAP_WORDS = Math.round(TARGET_WORDS * 0.15);            // ~58 (15% overlap)

// A chunk that begins with one of these refers OUTWARD — to text the engine threw
// away when it isolated the chunk. The #1 self-containment defect.
const LEADING_ANAPHORA = /^\s*(this|that|these|those|it|they|them|he|she|here|there|such|its|their|the (former|latter|above|same))\b/i;
// Pronoun/demonstrative density anywhere in the chunk (weaker signal than leading).
const ANAPHORA_TOKENS = /\b(this|that|these|those|it|they|them|its|their)\b/gi;
// A heading-dependent opener: the chunk only makes sense under a section title.
const HEADING_DEPENDENT = /^\s*(first|second|third|next|then|finally|also|additionally|another|one (option|way|benefit)|step \d|pros?:|cons?:|benefits?:|here'?s how)\b/i;
// Truncated-list / mid-thought tells.
const TRUNCATED_OPEN = /^\s*(and|but|or|so|because|which|who|whom|whose|where|when|while|although|however|therefore|including|such as)\b/i;
const TRUNCATED_END = /[,;:]\s*$|\b(including|such as|for example|e\.g\.|like)\s*$/i;

const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

// Sentinel used to hide abbreviation/decimal dots from the sentence-boundary regex,
// then restored. A private-use codepoint that will never occur in real copy.
const DOT_SENTINEL = '';

/**
 * Split text into sentences on terminal punctuation, keeping the punctuation and
 * respecting common abbreviations / decimals (no mid-number or "Dr." splits).
 */
export function splitSentences(text) {
  // Strip any pre-existing DOT_SENTINEL (U+E000) so a malicious/odd input with
  // that character cannot corrupt the abbreviation-guarding logic below.
  const t = clean((text || '').split(DOT_SENTINEL).join(''));
  if (!t) return [];
  const guarded = t
    .replace(/\b(Mr|Mrs|Ms|Dr|St|Sr|Jr|vs|etc|Inc|Ltd|Co|No|Fig|Approx|Dept)\./gi, '$1' + DOT_SENTINEL)
    .replace(/(\d)\.(\d)/g, '$1' + DOT_SENTINEL + '$2');
  const parts = guarded.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/);
  return parts.map((s) => s.split(DOT_SENTINEL).join('.').trim()).filter(Boolean);
}

/**
 * Recursive ~400-600 token splitter with ~15% overlap. We split on the natural
 * hierarchy (sections → sentences) and pack sentences into chunks up to the target
 * size, carrying the trailing ~15% of words into the next chunk so a claim spanning
 * a boundary survives — exactly the engine's chunking contract (D1).
 *
 * @param {Array<{heading:string, text:string}>} sections heading-scoped blocks
 * @returns {Array<{index, heading, text, words, sentences:string[]}>}
 */
function recursiveSplit(sections) {
  const chunks = [];
  for (const sec of sections) {
    const sentences = splitSentences(sec.text);
    if (!sentences.length) continue;
    let buf = [];
    let bufWords = 0;
    const flush = () => {
      if (!buf.length) return;
      const text = buf.join(' ');
      chunks.push({ heading: sec.heading || '', text, words: countWords(text), sentences: buf.slice() });
      // Carry the trailing ~15% (by words) into the next chunk for overlap.
      const carry = [];
      let cw = 0;
      for (let i = buf.length - 1; i >= 0 && cw < OVERLAP_WORDS; i--) { carry.unshift(buf[i]); cw += countWords(buf[i]); }
      buf = carry;
      bufWords = cw;
    };
    for (const s of sentences) {
      const w = countWords(s);
      // A single mega-sentence > MAX becomes its own chunk (can't split a sentence).
      if (w > MAX_WORDS) { flush(); chunks.push({ heading: sec.heading || '', text: s, words: w, sentences: [s] }); buf = []; bufWords = 0; continue; }
      if (bufWords + w > TARGET_WORDS && bufWords >= MIN_WORDS) flush();
      buf.push(s); bufWords += w;
    }
    if (buf.length) { const text = buf.join(' '); chunks.push({ heading: sec.heading || '', text, words: countWords(text), sentences: buf.slice() }); }
  }
  return chunks.map((c, i) => ({ ...c, index: i }));
}

/**
 * Chunk a page's RAW HTML the way an answer engine does.
 * Groups body content under its nearest preceding heading (sections), strips
 * non-content nodes, then recursive-splits each section into 400-600 token chunks.
 * @param {string} html raw server HTML (no JS execution — what crawlers see)
 * @returns {Array<{index, heading, text, words, sentences:string[]}>}
 */
export function chunkPage(html) {
  const $ = cheerio.load(html || '');
  $('script,style,noscript,svg,template,nav,header,footer,form,aside').remove();
  const root = $('main').length ? $('main') : $('body');

  // Walk block-level nodes in document order, opening a new section at each heading.
  const sections = [];
  let cur = { heading: '', text: '' };
  const push = () => { if (clean(cur.text)) sections.push({ heading: clean(cur.heading), text: clean(cur.text) }); };
  root.find('h1,h2,h3,h4,h5,h6,p,li,td,th,blockquote,dd,dt,figcaption').each((_, el) => {
    const tag = el.tagName?.toLowerCase() || '';
    const txt = clean($(el).text());
    if (!txt) return;
    if (/^h[1-6]$/.test(tag)) { push(); cur = { heading: txt, text: '' }; }
    else cur.text += (cur.text ? ' ' : '') + txt;
  });
  push();
  // Fallback: if structure is too thin, treat the whole visible body as one section.
  if (!sections.length) { const body = clean(root.text()) || clean($('body').text()); if (body) sections.push({ heading: '', text: body }); }
  return recursiveSplit(sections);
}

// Capitalized words that are NOT entities (sentence-initial function words / demonstratives).
const NON_ENTITY = /^(This|That|These|Those|It|They|There|Here|The|A|An|And|But|Or|So|If|When|While|However|Most|Some|Many|Our|Your|We|You|First|Second|Next|Then)$/;

/** First entity-like proper noun / capitalized multiword term in a string (heuristic). */
function firstEntity(text) {
  const re = /\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){0,3})\b/g;
  let m;
  while ((m = re.exec(clean(text)))) { if (!NON_ENTITY.test(m[1])) return m[1]; }
  return null;
}

/**
 * Score one chunk for self-containment / passage independence.
 * Each defect costs points off a 100 baseline; the issues[] list drives the rewrite
 * suggestion. A chunk that opens with the entity + a concrete claim and ends on a
 * sentence boundary scores high — it survives being ripped out of the page.
 * @returns {{index, heading, words, score, independent, issues:string[], firstSentence, suggestion}}
 */
export function scoreChunk(chunk) {
  const text = clean(chunk.text);
  const first = (chunk.sentences && chunk.sentences[0]) || splitSentences(text)[0] || text;
  const issues = [];
  let score = 100;

  // 1) Leading anaphora — refers to text outside the chunk (the worst defect).
  if (LEADING_ANAPHORA.test(text)) { issues.push('opens-with-anaphora'); score -= 35; }
  // 2) Heading-dependent opener — only parses under its section title.
  else if (HEADING_DEPENDENT.test(text)) { issues.push('needs-prior-heading'); score -= 20; }
  // 3) Truncated open (conjunction/relative) — a sentence fragment.
  if (TRUNCATED_OPEN.test(text)) { issues.push('truncated-open'); score -= 18; }
  // 4) Truncated end — dangling list intro / trailing punctuation.
  if (TRUNCATED_END.test(text)) { issues.push('truncated-end'); score -= 15; }
  // 5) Missing subject entity — no proper-noun / capitalized term anywhere.
  const entity = firstEntity(text);
  if (!entity) { issues.push('missing-entity'); score -= 15; }
  // 6) High anaphora density (>3% of words are pronouns/demonstratives) — ambiguous referents.
  const anaCount = (text.match(ANAPHORA_TOKENS) || []).length;
  if (chunk.words >= 20 && anaCount / chunk.words > 0.03) { issues.push('high-anaphora-density'); score -= 10; }
  // 7) Size out of the 400-600 token sweet spot (over-fragmenting hurts retrieval too — D1).
  if (chunk.words < MIN_WORDS) { issues.push('too-short'); score -= 12; }
  else if (chunk.words > MAX_WORDS) { issues.push('too-long'); score -= 10; }
  // 8) No concrete claim signal (number, unit, or declarative cue) — weak as a standalone answer.
  if (!/\d|\$|%|\b(is|are|costs?|takes?|lasts?|requires?|includes?|ranges?)\b/i.test(first)) { issues.push('no-concrete-claim'); score -= 8; }

  score = Math.max(0, Math.min(100, score));
  return {
    index: chunk.index,
    heading: chunk.heading || '',
    words: chunk.words,
    score,
    independent: score >= 70 && !issues.includes('opens-with-anaphora'),
    issues,
    firstSentence: first.slice(0, 200),
    suggestion: suggestRewrite(chunk, issues, entity),
  };
}

/** Deterministic, fact-preserving rewrite guidance for a chunk's defects. */
function suggestRewrite(chunk, issues, entity) {
  if (!issues.length) return null;
  const tips = [];
  if (issues.includes('opens-with-anaphora')) tips.push(`Replace the leading pronoun with the explicit subject${entity ? ` ("${entity}")` : ' (name the treatment/business)'} so the passage stands alone.`);
  if (issues.includes('needs-prior-heading')) tips.push('Restate the topic in the first sentence — don\'t rely on the section heading to supply it.');
  if (issues.includes('truncated-open')) tips.push('Start the chunk on a full sentence, not a conjunction/relative clause.');
  if (issues.includes('truncated-end')) tips.push('End on a complete sentence; finish the list or claim the chunk introduces.');
  if (issues.includes('missing-entity')) tips.push('Name the subject entity (treatment, brand, city) explicitly within the passage.');
  if (issues.includes('high-anaphora-density')) tips.push('Reduce pronouns/demonstratives whose referents live outside the chunk; use concrete nouns.');
  if (issues.includes('too-short')) tips.push('Merge with adjacent context — sub-300-word shards under-retrieve (over-fragmenting hurts).');
  if (issues.includes('too-long')) tips.push('Split into ~400-600 token blocks so the citable claim isn\'t buried.');
  if (issues.includes('no-concrete-claim')) tips.push('Lead with a concrete, declarative claim (a number, range, or "X is/costs/takes …").');
  return tips.join(' ');
}

/**
 * Chunk + score a page. The top-level entry point.
 * @param {string} html raw server HTML
 * @returns {{chunks, scored, summary:{count, independent, avgScore, worst}}}
 */
export function scorePassages(html) {
  const chunks = chunkPage(html);
  const scored = chunks.map(scoreChunk);
  const count = scored.length;
  const independent = scored.filter((s) => s.independent).length;
  const avgScore = count ? Math.round(scored.reduce((a, s) => a + s.score, 0) / count) : 0;
  const worst = scored.slice().sort((a, b) => a.score - b.score).slice(0, 5);
  return { chunks, scored, summary: { count, independent, avgScore, worst } };
}
