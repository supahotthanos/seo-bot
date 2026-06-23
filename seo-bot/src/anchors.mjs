// seo-bot · anchors — entropy-constrained, anti-slop anchor-text selector.
//
// Over-optimized anchors are a footprint: if every inlink to /services/botox says
// "botox" (exact-match), the pattern reads as manipulated and the relevance signal
// collapses (Cyrus Shepard's 23M-link study: ANCHOR VARIETY beats exact-match volume).
// This module generates 3–5 human-plausible anchor variants from the target page's own
// H1/title noun phrases, then SCORES each by relevance × diversity, where diversity is a
// running Shannon-entropy bonus over anchors already used across the site this run. The
// result keeps the site's anchor distribution high-entropy (natural), never exact-stuffed.
//
// LLM is OPTIONAL (same gate as decide.mjs): with ANTHROPIC_API_KEY it proposes natural
// phrasings grounded ONLY in the target title/H1; without it, deterministic noun-phrase
// extraction is used. Either way every candidate passes an anti-slop filter, and the final
// pick is ALWAYS flagged needsHumanReview — anchors are never auto-inserted unreviewed.

const GENERIC = /^(click here|read more|here|learn more|this|link|more|see more|find out more|website|page)$/i;
const PROMO = /\b(best|#1|number one|top|leading|ultimate|amazing|premier|cheapest|guaranteed|world[- ]class)\b/i;
const STOP = new Set('a an the of and or for to in on at with your you our we us is are this that how what why best near me cost price guide services service'.split(' '));

/** Title-case a phrase for display variants. */
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Extract candidate noun phrases (1–4 content words) from a target's title + H1. */
export function nounPhrases(target = {}) {
  const phrases = new Set();
  // Window each source (h1, title) SEPARATELY so a phrase never spans two unrelated strings.
  for (const raw of [target.h1, target.title]) {
    if (!raw) continue;
    // Strip site-name tails ("… | Brand", "… - Brand") and punctuation.
    const cleaned = raw.toLowerCase().split(/[|–—]| - /)[0].replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const words = cleaned.split(' ').filter(Boolean);
    // Sliding windows of 2–4 content words that don't start/end on a stopword and have no repeats.
    for (let n = 4; n >= 2; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const win = words.slice(i, i + n);
        if (STOP.has(win[0]) || STOP.has(win[win.length - 1])) continue;
        if (new Set(win).size !== win.length) continue; // drop "botox treatment botox"-style repeats
        const phrase = win.join(' ');
        if (phrase.length >= 6 && phrase.length <= 60) phrases.add(phrase);
      }
    }
    // Always include the lead content bigram even if short.
    const lead = words.filter((w) => !STOP.has(w)).slice(0, 2).join(' ');
    if (lead.length >= 4) phrases.add(lead);
  }
  return [...phrases].slice(0, 8);
}

/** Anti-slop filter: reject generic, promotional, empty, or absurdly long anchors. */
export function isCleanAnchor(text) {
  const t = (text || '').trim();
  if (!t || t.length < 3 || t.length > 70) return false;
  if (GENERIC.test(t)) return false;
  if (PROMO.test(t)) return false;
  if (!/[a-z]/i.test(t)) return false;
  return true;
}

async function llmVariants(target, { maxTokens = 160 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const model = process.env.SEO_BOT_MODEL || 'claude-sonnet-4-6';
    const msg = await client.messages.create({
      model, max_tokens: maxTokens,
      system: 'You write natural internal-link anchor text. Use ONLY words supported by the target page title/H1. Never use "best", "#1", "click here", or marketing superlatives. Each anchor must read like a phrase a human would naturally link. Output 4 distinct anchors, one per line, nothing else.',
      messages: [{ role: 'user', content: `TARGET TITLE: ${target.title || ''}\nTARGET H1: ${target.h1 || ''}\n\nGive 4 short, varied, descriptive anchor texts (2–5 words each) that could link TO this page from another page.` }],
    });
    try { const { recordUsage, getCostContext } = await import('./cost.mjs'); const c = getCostContext(); recordUsage(c.client, model, msg.usage, { tag: c.tag || 'anchors' }); } catch { /* telemetry only */ }
    return (msg.content?.[0]?.text || '').split('\n').map((l) => l.replace(/^[\d.)\-*\s"']+|["']+$/g, '').trim()).filter(Boolean);
  } catch { return null; }
}

/** Shannon entropy (nats) of a {anchorKey: count} distribution. Higher = more varied. */
export function anchorEntropy(usedCounts) {
  const counts = [...usedCounts.values()];
  const total = counts.reduce((s, c) => s + c, 0);
  if (!total) return 0;
  return -counts.reduce((s, c) => { const p = c / total; return s + p * Math.log(p); }, 0);
}

/** Normalize an anchor to a diversity key (lowercased, collapsed) for the used-anchors tally. */
const keyOf = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Pick the best anchor for one candidate link.
 * @param {{src:string, tgt:string, score?:number, target?:{title,h1}}} candidate
 * @param {{usedAnchors?:Map<string,number>, cfg?:object, log?:Function}} ctx
 *        usedAnchors = running site-wide tally of anchorKey→count (MUTATED on pick, so the
 *        next call sees this anchor and is pushed toward a different variant — the entropy lever).
 * @returns {Promise<{anchor:string, variants:string[], relevance:number, diversityBonus:number,
 *           score:number, needsHumanReview:true, reason?:string}>}
 *
 * Score = relevance(candidate.score) × (1 + diversityBonus), where diversityBonus penalizes
 * a variant already over-used to a money target (exact-match stuffing) and rewards fresh phrasing.
 */
export async function pickAnchor(candidate, { usedAnchors = new Map(), cfg = {}, log = () => {} } = {}) {
  const target = candidate.target || {};
  const relevance = typeof candidate.score === 'number' ? candidate.score : 0.5;

  // 1) Gather variants: LLM (optional) ∪ deterministic noun phrases ∪ a couple of templated forms.
  const variants = [];
  const llm = cfg.anchorsLLM === false ? null : await llmVariants(target);
  if (llm) variants.push(...llm);
  const phrases = nounPhrases(target);
  variants.push(...phrases);
  if (phrases[0]) { variants.push(titleCase(phrases[0])); variants.push(`${phrases[0]} options`); } // natural extra phrasings

  // 2) Filter anti-slop + de-dupe by key.
  const seen = new Set();
  const clean = [];
  for (const v of variants) {
    const k = keyOf(v);
    if (!k || seen.has(k) || !isCleanAnchor(v)) continue;
    seen.add(k); clean.push(v);
  }
  if (!clean.length) {
    // Last-resort: a non-exact descriptive fallback derived from the title's lead words.
    const fb = phrases[0] || (target.title || '').toLowerCase().split(/[|–—-]/)[0].trim().split(/\s+/).slice(0, 3).join(' ');
    if (fb && isCleanAnchor(fb)) clean.push(fb);
  }
  if (!clean.length) return { anchor: null, variants: [], relevance, diversityBonus: 0, score: 0, needsHumanReview: true, reason: 'no clean anchor candidate' };

  // 3) Score each variant: relevance × diversity. Diversity penalizes globally-overused anchors.
  const totalUsed = [...usedAnchors.values()].reduce((s, c) => s + c, 0) || 1;
  const ranked = clean.map((v) => {
    const used = usedAnchors.get(keyOf(v)) || 0;
    const overuse = used / totalUsed;            // 0..1 share of all anchors already this phrasing
    const diversityBonus = Math.max(-0.6, 0.5 - 4 * overuse); // fresh → +0.5; overused → penalty
    return { anchor: v, diversityBonus, score: relevance * (1 + diversityBonus) };
  }).sort((a, b) => b.score - a.score);

  const top = ranked[0];
  // 4) Commit to the running tally so subsequent picks see it (drives the distribution's entropy up).
  usedAnchors.set(keyOf(top.anchor), (usedAnchors.get(keyOf(top.anchor)) || 0) + 1);

  return {
    anchor: top.anchor,
    variants: ranked.map((r) => r.anchor),
    relevance: Math.round(relevance * 1000) / 1000,
    diversityBonus: Math.round(top.diversityBonus * 1000) / 1000,
    score: Math.round(top.score * 1000) / 1000,
    entropy: Math.round(anchorEntropy(usedAnchors) * 1000) / 1000,
    needsHumanReview: true, // anti-slop hard rule: anchors are never inserted without human sign-off
  };
}
