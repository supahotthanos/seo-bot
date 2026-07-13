// seo-bot · content/optimize — the scorer→fix closed loop (Epic 7, anti-slop).
//
// Orchestrates: buildCorpus(query) → extractTerms → scoreContent(draft) → emit term-gap
// fix PROPOSALS in the standard proposal shape. The hard anti-slop rule: a term-gap fix
// may ONLY edit a REAL existing sentence — never invent a new sentence or a new claim.
//
// How we honor that:
//   • For each high-weight MISSING/UNDER term, we find the single most topically-adjacent
//     EXISTING sentence in the draft (token overlap with the term's words). That real
//     sentence becomes the proposal's `current` AND the `patch.find` (exact, unique).
//   • The `proposed` rewrite weaves the missing term into THAT sentence using the
//     constrained on-page editor (decide.mjs-style system prompt: "rewrite ONLY using
//     facts present; never invent"). If the LLM is unavailable, OR the rewrite adds any
//     new number/claim, we DROP the auto-patch and emit an ADVISORY proposal naming the
//     sentence + term for a human to weave by hand. Nothing fabricated ever ships.
//   • Every proposal is autoApplicable:false on the content path → always human-reviewed.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso, slugify } from '../util.mjs';
import { buildCorpus } from './corpus.mjs';
import { extractTerms, tokenize } from './terms.mjs';
import { scoreContent, parseDraftSignals } from './score.mjs';
import { buildTopicModel } from './topicmodel.mjs';

const NUM_RE = /\$?\d[\d,]*(?:\.\d+)?%?/g;

/** Split a draft's visible body into sentences with their exact source substrings.
 *  Avoids splitting on periods inside:
 *    - decimal numbers / prices / percentages (digit . digit)
 *    - URLs / domain names (word-char . word-char with no surrounding space)
 *    - common abbreviations (single-letter . single-letter sequences, e.g. "e.g.", "U.S.")
 */
export function draftSentences(draft = '') {
  const body = parseDraftSignals(draft).body;
  // Mark periods that are NOT sentence terminators with a placeholder so we can
  // split cleanly afterwards, then restore them.
  const PLACEHOLDER = '\x00';
  const safe = body
    // decimal numbers / prices:  3.14  $1.99  0.5%
    .replace(/(\d)\.(\d)/g, `$1${PLACEHOLDER}$2`)
    // URL / domain-like: letter.letter with no surrounding whitespace
    // catches site.com, e.g., U.S.A., Dr., Mr., etc.
    .replace(/(\w)\.(\w)/g, `$1${PLACEHOLDER}$2`);

  // A sentence boundary is [.!?]+ followed by whitespace+uppercase, whitespace+end, or string-end.
  // We collect chunks by splitting on those real terminators.
  const out = [];
  // Split on terminator sequences that are followed by space+capital or end-of-string.
  // We use a lookahead to keep the terminator attached to the preceding text.
  const chunks = safe.split(/(?<=[.!?]{1,3})(?=\s+[A-Z"'“‘]|\s*$)/);
  for (const chunk of chunks) {
    const s = chunk.replace(new RegExp(PLACEHOLDER, 'g'), '.').trim();
    if (s.split(/\s+/).length >= 6) out.push(s);
  }
  return out;
}

/** Find the existing sentence with the most token overlap with `term` (anti-invent anchor). */
function bestAnchorSentence(sentences, term) {
  const tw = new Set(tokenize(term));
  let best = null, bestScore = 0;
  for (const s of sentences) {
    const stoks = new Set(tokenize(s));
    let overlap = 0; for (const w of tw) if (stoks.has(w)) overlap++;
    // require partial topical adjacency but NOT the full term (else it's already present)
    const score = overlap - (containsTerm(s, term) ? 99 : 0);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore > 0 ? best : null;
}

function containsTerm(text, term) {
  const t = tokenize(text), parts = term.split(' ');
  for (let i = 0; i + parts.length <= t.length; i++) {
    let ok = true; for (let j = 0; j < parts.length; j++) if (t[i + j] !== parts[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

const numbersIn = (s) => (String(s).match(NUM_RE) || []).map((n) => n.replace(/[,$%]/g, ''));

/** True if `rewrite` introduced any number not present in `original` (a fabrication tell). */
function addsNumbers(original, rewrite) {
  const before = new Set(numbersIn(original));
  return numbersIn(rewrite).some((n) => !before.has(n) && (Number(n) > 9 || n.includes('.')));
}

/** Constrained rewrite: weave `term` into `sentence`, inventing nothing. Returns string|null. */
async function weaveTerm(sentence, term) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const model = process.env.SEO_BOT_MODEL || 'claude-sonnet-4-6';
    const msg = await client.messages.create({
      model, max_tokens: 160,
      system: 'You are an on-page SEO/AEO editor. Rewrite ONLY using facts present in the given sentence. Never add a new statistic, claim, price, award, or superlative. Naturally incorporate the provided phrase if and only if it fits the existing meaning; if it cannot fit without inventing, return the sentence UNCHANGED. Output ONLY the single rewritten sentence.',
      messages: [{ role: 'user', content: `PHRASE TO INCORPORATE: "${term}"\nSENTENCE: ${sentence}` }],
    });
    try { const { recordUsage, getCostContext } = await import('../cost.mjs'); const c = getCostContext(); recordUsage(c.client, model, msg.usage, { tag: 'content-optimize' }); } catch { /* telemetry */ }
    const out = (msg.content?.[0]?.text || '').trim().replace(/^["']|["']$/g, '');
    return out || null;
  } catch { return null; }
}

/**
 * Generate term-gap fix proposals for a draft against a query's competitor corpus.
 * @returns {{ query, draftFile, score, proposals:[...], terms, model }}
 */
export async function optimizeDraft(cfg, { query, draftFile, draft, allowSerp = false, maxFixes = 8, log = () => {} } = {}) {
  if (!query) throw new Error('optimizeDraft: query is required');
  const text = draft != null ? draft : (draftFile && existsSync(draftFile) ? readFileSync(draftFile, 'utf-8') : null);
  if (text == null) throw new Error('optimizeDraft: pass draft text or an existing draftFile');

  try { const { setCostContext } = await import('../cost.mjs'); setCostContext({ client: cfg.name, tag: 'content-optimize' }); } catch { /* telemetry */ }

  const corpus = await buildCorpus(cfg, query, { log, allowSerp });
  const terms = extractTerms(corpus);
  const model = buildTopicModel(corpus);
  const scored = scoreContent(text, terms, { cfg, corpus, primaryTerm: query });
  log(`  content score: ${scored.score}/100 (coverage ${Math.round(scored.components.coverage * 100)}% · structure ${Math.round(scored.components.structure * 100)}% · placement ${Math.round(scored.components.placement * 100)}%)`);
  log(`  terms: ${scored.stats.inRange}/${scored.stats.termsScored} in-range · ${scored.stats.missing} missing · ${scored.stats.under} under · ${scored.stats.over} over`);

  const sentences = draftSentences(text);
  // Target the highest-weight gaps first; skip over-used terms (those need trimming, not adding).
  const gaps = scored.termTable
    .filter((t) => (t.state === 'missing' || t.state === 'under') && t.weight >= 0.1)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxFixes);

  const proposals = [];
  let pid = 0;
  const pageGuess = draftFile ? `/blog/${slugify(basename(draftFile, '.md'))}` : (cfg.baseUrl || '');
  for (const g of gaps) {
    const anchor = bestAnchorSentence(sentences, g.term);
    let proposed = null, kind = 'advisory';
    if (anchor) {
      const woven = await weaveTerm(anchor, g.term);
      if (woven && woven !== anchor && containsTerm(woven, g.term) && !addsNumbers(anchor, woven)) {
        proposed = woven; kind = 'patch';
      }
    }
    const base = {
      id: ++pid, type: 'term-gap', page: pageGuess, severity: g.state === 'missing' ? 'medium' : 'low',
      autoApplicable: false, // content edits are ALWAYS human-reviewed
      term: g.term, state: g.state, count: g.count, recommended: g.recommended,
      rationale: `Competitors cover "${g.term}" (recommended ${g.recommended.min}-${g.recommended.max}×; draft has ${g.count}). Weave into a real existing sentence — never invent a new claim.`,
    };
    if (kind === 'patch' && anchor) {
      proposals.push({ ...base, current: anchor, proposed, patch: { find: anchor, replace: proposed } });
    } else {
      proposals.push({ ...base,
        current: anchor ? anchor : '(no adjacent sentence found — author a real, sourced sentence)',
        proposed: anchor
          ? `Hand-weave "${g.term}" into this real sentence (no new numbers/claims): "${anchor}"`
          : `Add "${g.term}" only inside a genuine, sourced sentence — do not invent.` });
    }
  }

  log(`  term-gap proposals: ${proposals.length} (${proposals.filter((p) => p.patch).length} with a constrained-rewrite patch, rest advisory).`);
  return { query, draftFile: draftFile || null, score: scored.score, scored, proposals, terms, model };
}

/** Write the optimize report (md + json) under reports/<client>/. */
export function saveOptimizeReport(cfg, result) {
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const slug = slugify(result.query);
  const json = join(dir, `content-optimize-${slug}.json`);
  writeFileSync(json, JSON.stringify({
    client: cfg.name, query: result.query, draftFile: result.draftFile, at: nowIso(),
    score: result.score, components: result.scored.components, structure: result.scored.structure,
    placement: result.scored.placement, termTable: result.scored.termTable, proposals: result.proposals,
    wordCountRange: result.model.wordCountRange,
  }, null, 2));

  const s = result.scored;
  const L = [`# Content optimize — ${cfg.brand}`,
    `query: "${result.query}" · ${result.draftFile ? basename(result.draftFile) : '(inline draft)'} · ${nowIso()}`, '',
    `**Content Score ${result.score}/100** — coverage ${pct(s.components.coverage)} · structure ${pct(s.components.structure)} · placement ${pct(s.components.placement)}`,
    `words ${s.structure.draftWords} (competitor median ${s.structure.targetWords}) · headings ${s.structure.headingCount}/${s.structure.targetHeadings} · schema ${s.structure.hasSchema ? 'yes' : 'no'}`,
    `primary "${s.placement.primary}": title ${s.placement.inTitle ? '✓' : '✗'} · H1 ${s.placement.inH1 ? '✓' : '✗'} · Hn ${s.placement.inHn ? '✓' : '✗'} · body ${s.placement.inBodyCount}×`, '',
    `## Term gaps (anti-slop: edit real sentences only)`];
  for (const p of result.proposals) {
    L.push(`- **${p.term}** (${p.state}, have ${p.count}, want ${p.recommended.min}-${p.recommended.max}) ${p.patch ? '— constrained-rewrite patch ready' : '— advisory (hand-weave)'}`);
    if (p.current) L.push(`  - now: ${String(p.current).slice(0, 160)}`);
    if (p.proposed) L.push(`  - proposed: ${String(p.proposed).slice(0, 200)}`);
  }
  L.push('', `## Top recommended terms (competitor TF-IDF)`);
  for (const t of s.termTable.slice(0, 25)) L.push(`- ${t.term} — have ${t.count}, want ${t.recommended.min}-${t.recommended.max} (${t.state})`);
  const md = join(dir, `content-optimize-${slug}.md`);
  writeFileSync(md, L.join('\n'));
  return { json, md };
}

const pct = (x) => `${Math.round(x * 100)}%`;
