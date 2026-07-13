// seo-bot · measure/answer-position — WHERE in the answer, not just whether.
//
// Today the tracker records mentioned/cited per (prompt, engine). But AI answers are
// mostly ranked lists ("Top 5 med spas in Miami: …"), and being #1 in the list vs #7
// is a different commercial reality the flat mentioned:true hides. This module finds
// ordered/ranked structures in a rendered answer (numbered markdown lists, "Top N"
// prose runs, bullet lists) and returns the brand's position inside them, plus how
// deep into the whole answer the first brand mention lands (0 = leads the answer).
//
// Pure + null-safe. No scraping, no deps. Consumed by scripts/ai-visibility/track.mjs
// (per-sample), aggregated by aggregateSamples (median) and measure/sov.mjs (avg).
// Fail-closed: anything unparseable → nulls, never a fabricated position.

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word/phrase regex (case handled by lowercasing inputs) — same boundary
 *  discipline as track.mjs matchInfo, so "Glow" never matches "glowing". */
function termRe(term) {
  const body = escRe(String(term).toLowerCase().trim()).replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`);
}

/** First char index of any brand term in text (lowercased match), or -1. */
function firstIndex(textLower, terms) {
  let first = -1;
  for (const t of terms) {
    const m = termRe(t).exec(textLower);
    if (m && (first === -1 || m.index < first)) first = m.index;
  }
  return first;
}

/** Strip markdown decoration + trailing descriptor from a list item to get a name
 *  candidate. Returns null unless trivially extractable (short, no leftover markup). */
function itemName(itemText) {
  let s = String(itemText || '').replace(/\*\*|__|\*|`/g, '').trim();
  // cut at the first descriptor separator: em/en dash, " - ", colon, comma, paren
  const cut = s.search(/\s+[—–]\s+|\s+-\s+|[:,(]/);
  if (cut !== -1) s = s.slice(0, cut);
  s = s.replace(/[.!?\s]+$/, '').trim();
  if (!s || s.length < 2 || s.length > 60 || /https?:\/\//i.test(s)) return null;
  return s;
}

/** Parse numbered list items ("1. x", "2) y", "- 3. z") out of the answer lines. */
function numberedItems(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*+]\s+)?(\d{1,2})[.)]\s+(.+)/);
    if (m) out.push({ n: Number(m[1]), text: m[2] });
  }
  // require a real ranked run: >=2 items, starting at 1 (kills stray "2024." artifacts)
  return out.length >= 2 && out[0].n === 1 ? out : null;
}

/** Parse an un-numbered markdown bullet list (order = rank by appearance). */
function bulletItems(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*[-*+]\s+(.+)/);
    if (m && !/^\d{1,2}[.)]\s/.test(m[1])) out.push({ n: out.length + 1, text: m[1] });
  }
  return out.length >= 2 ? out : null;
}

/** "Top N" prose run: "the top 5 med spas …: A, B, C, D, and E." */
function topNRun(text) {
  const m = /\btop\s+(\d{1,2})\b/i.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index);
  const sentence = (rest.split(/(?<=[.!?])\s|\n/)[0] || rest).slice(0, 600);
  let seg = sentence;
  const colon = sentence.indexOf(':');
  if (colon !== -1) seg = sentence.slice(colon + 1);
  else {
    const vm = /\b(?:are|include|includes)\b/i.exec(sentence);
    if (vm) seg = sentence.slice(vm.index + vm[0].length);
    else return null; // "top 5" mentioned but no enumerable run — do not guess
  }
  const items = seg.replace(/[.!?]\s*$/, '')
    .split(/,\s*(?:and\s+)?|\s+and\s+/i)
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 80);
  if (items.length < 3) return null;
  return items.map((t, i) => ({ n: i + 1, text: t }));
}

/**
 * Extract the brand's position inside the answer's ranked structure (if any).
 *
 * @param {string} answerText full rendered answer (markdown or innerText)
 * @param {string} brand brand name (case-insensitive whole-phrase match)
 * @param {{aliases?: string[]}} [o]
 * @returns {{listDetected:boolean, position:number|null, listSize:number|null,
 *            firstMentionCharRatio:number|null, competitors:Array<{name?:string, position:number}>}}
 *   position/listSize null when no list or brand not in it; firstMentionCharRatio is the
 *   0-1 offset of the FIRST brand mention in the whole answer (null when never mentioned);
 *   competitors only carries entries whose names were trivially extractable.
 */
export function extractAnswerPosition(answerText, brand, { aliases = [] } = {}) {
  const empty = { listDetected: false, position: null, listSize: null, firstMentionCharRatio: null, competitors: [] };
  const text = typeof answerText === 'string' ? answerText : '';
  const terms = [brand, ...(Array.isArray(aliases) ? aliases : [])]
    .map((t) => String(t || '').trim()).filter(Boolean);
  if (!text) return empty;

  const textLower = text.toLowerCase();
  const first = terms.length ? firstIndex(textLower, terms) : -1;
  const firstMentionCharRatio = first === -1 ? null
    : Math.round((first / Math.max(1, text.length)) * 1000) / 1000;

  // Structure priority: numbered list > bullet list > "Top N" comma run.
  const lines = text.split(/\r?\n/);
  const items = numberedItems(lines) || bulletItems(lines) || topNRun(text);
  if (!items) return { ...empty, firstMentionCharRatio };

  let position = null;
  const competitors = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const rank = Number.isFinite(it.n) && it.n >= 1 && it.n <= 50 ? it.n : i + 1;
    const isBrand = terms.length > 0 && firstIndex(it.text.toLowerCase(), terms) !== -1;
    if (isBrand && position === null) { position = rank; continue; }
    if (!isBrand && competitors.length < 15) {
      const name = itemName(it.text);
      competitors.push(name ? { name, position: rank } : { position: rank });
    }
  }
  return { listDetected: true, position, listSize: items.length, firstMentionCharRatio, competitors };
}
