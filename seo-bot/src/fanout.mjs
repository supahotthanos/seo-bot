// seo-bot · fanout — query fan-out simulator.
//
// 2026 answer engines do NOT answer from a page's top rank — they decompose one
// user query into ~8-15 synthetic sub-queries (Google AI Mode's "query fan-out"),
// run each in parallel, retrieve passages, and RRF-fuse. Pages that answer the head
// query AND the fan-out sub-queries are ~161% more likely to be cited (iPullRank).
//
// Google's patents (US20240289407A1, US11663201B2, WO2024064249A1) enumerate ~8
// generator TYPES. We reproduce them locally so other modules (content planning,
// capsule placement, rrf.mjs) can ensure a page covers the WHOLE fan-out, not just
// the head term. Plus med-spa-specific intent variants (price/safety/downtime/
// near-me/comparison) that dominate local YMYL search.
//
// LLM-optional, mirroring decide.mjs: if ANTHROPIC_API_KEY is set we ask the model
// for natural-language phrasings (it rewrites the query, never invents facts); the
// deterministic template fallback always runs so this works with zero API access.

// The ~8 patent-class sub-query generator types (D1/D2). `tpl` is a deterministic
// phrasing template; `{q}` = the head query, `{ent}` = its salient entity/noun.
const PATENT_TYPES = [
  { type: 'equivalent', desc: 'reformulation / synonymous restatement', tpl: (q) => `${q} explained` },
  { type: 'follow-up', desc: 'implicit next question in the session', tpl: (q) => `what to know before ${q}` },
  { type: 'generalization', desc: 'broaden to the parent topic', tpl: (q, e) => `${e} overview` },
  { type: 'specification', desc: 'narrow to a specific facet', tpl: (q, e) => `${e} for first-time patients` },
  { type: 'canonicalization', desc: 'map to the canonical entity name', tpl: (q, e) => `${e} (official name and definition)` },
  { type: 'comparison', desc: 'versus an alternative', tpl: (q, e) => `${e} vs alternatives` },
  { type: 'entity-expanded', desc: 'Knowledge-Graph entity substitution', tpl: (q, e) => `${e} provider near me` },
  { type: 'recent', desc: 'freshness / current-state variant', tpl: (q) => `${q} in ${new Date().getFullYear()}` },
];

// Med-spa intent variants — the local YMYL fan-out that the patent classes don't
// cover but that real users (and AI Mode's local sub-queries) fire constantly.
const MEDSPA_VARIANTS = [
  { type: 'price', desc: 'cost / pricing intent', tpl: (q, e) => `how much does ${e} cost` },
  { type: 'safety', desc: 'risk / side-effect intent', tpl: (q, e) => `is ${e} safe` },
  { type: 'downtime', desc: 'recovery / downtime intent', tpl: (q, e) => `${e} recovery time and downtime` },
  { type: 'near-me', desc: 'local provider intent', tpl: (q, e, geo) => `${e} near ${geo || 'me'}` },
  { type: 'comparison', desc: 'treatment comparison intent', tpl: (q, e) => `${e} vs other treatments` },
];

// Stopwords stripped when guessing the salient entity from a head query.
const STOP = new Set(['how', 'much', 'does', 'do', 'is', 'are', 'the', 'a', 'an', 'to', 'of', 'in', 'for', 'cost', 'costs', 'price', 'near', 'me', 'my', 'best', 'what', 'why', 'when', 'where', 'which', 'who', 'and', 'or', 'with', 'get', 'getting', 'vs', 'versus', 'about']);

/** Heuristic: pull the salient entity/noun phrase from a head query (no LLM needed). */
export function salientEntity(query) {
  const words = String(query || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !STOP.has(w));
  const phrase = (kept.length ? kept : words).slice(0, 3).join(' ').trim();
  return phrase || String(query || '').trim();
}

/** Deterministic fan-out (always available). Returns the full sub-query set. */
function templateFanout(query, { entity, geo, medspa = true } = {}) {
  const e = entity || salientEntity(query);
  const out = [];
  const seen = new Set();
  const add = (cls, type, desc, text) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key) || key === String(query).toLowerCase().trim()) return;
    seen.add(key);
    out.push({ class: cls, type, description: desc, query: t });
  };
  for (const g of PATENT_TYPES) add('patent', g.type, g.desc, g.tpl(query, e, geo));
  if (medspa) for (const g of MEDSPA_VARIANTS) add('medspa', g.type, g.desc, g.tpl(query, e, geo));
  return out;
}

/** Optional LLM phrasing of the sub-queries (mirrors decide.mjs; never invents facts). */
async function llmFanout(query, { entity, geo } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const model = process.env.SEO_BOT_MODEL || 'claude-sonnet-4-6';
    const types = [...PATENT_TYPES, ...MEDSPA_VARIANTS].map((t) => `${t.type}: ${t.desc}`).join('\n');
    const prompt = `A user searched: "${query}".
Generate the natural sub-queries an AI answer engine would fan out to. Produce EXACTLY one line per type below, formatted "type | sub-query" (no numbering, no extra text). Keep each a real, short user query. Do not invent facts, prices, or claims; just rephrase the intent.${geo ? ` Local area: ${geo}.` : ''}
TYPES:
${types}`;
    const msg = await client.messages.create({ model, max_tokens: 500, system: 'You expand a search query into its fan-out sub-queries. Output only "type | sub-query" lines.', messages: [{ role: 'user', content: prompt }] });
    try { const { recordUsage, getCostContext } = await import('./cost.mjs'); const c = getCostContext(); recordUsage(c.client, model, msg.usage, { tag: 'fanout' }); } catch { /* telemetry only */ }
    const txt = (msg.content?.[0]?.text || '').trim();
    const known = new Map([...PATENT_TYPES.map((t) => [t.type, 'patent']), ...MEDSPA_VARIANTS.map((t) => [t.type, 'medspa'])]);
    const descs = new Map([...PATENT_TYPES, ...MEDSPA_VARIANTS].map((t) => [t.type, t.desc]));
    const out = [];
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([a-z-]+)\s*\|\s*(.+?)\s*$/i);
      if (!m) continue;
      const type = m[1].toLowerCase();
      if (!known.has(type)) continue;
      out.push({ class: known.get(type), type, description: descs.get(type) || '', query: m[2] });
    }
    return out.length >= 4 ? out : null; // fall back to template if the model under-delivered
  } catch { return null; }
}

/**
 * Expand a target query into its ~8 patent-class sub-queries + med-spa variants.
 * LLM-optional with a deterministic template fallback (always works offline).
 * @param {string} query the head query
 * @param {{cfg?, entity?, geo?, medspa?, useLLM?}} opts
 *   cfg     — client config (reads cfg.serviceAreaGeos[0] for the near-me geo)
 *   medspa  — include med-spa intent variants (default true; auto-on if cfg.vertical==='medspa')
 * @returns {Promise<{query, entity, geo, source, subqueries:Array<{class,type,description,query}>}>}
 */
export async function expandQuery(query, { cfg = {}, entity, geo, medspa, useLLM = true } = {}) {
  const ent = entity || salientEntity(query);
  const g = geo || cfg.serviceAreaGeos?.[0] || cfg.locations?.[0]?.nap?.city || '';
  const wantMedspa = medspa ?? (cfg.vertical === 'medspa' || true);
  let subqueries = null;
  let source = 'template';
  if (useLLM) { const llm = await llmFanout(query, { entity: ent, geo: g }); if (llm) { subqueries = llm; source = 'llm'; } }
  if (!subqueries) subqueries = templateFanout(query, { entity: ent, geo: g, medspa: wantMedspa });
  return { query: String(query || '').trim(), entity: ent, geo: g, source, subqueries };
}

/**
 * Coverage check: which sub-queries does a page actually answer?
 * Term-overlap heuristic against the page's headings + visible text (no embeddings
 * required). Surfaces MISSING sub-topics → a content-gap worklist for decide.mjs.
 * @param {{subqueries}} fanout  result of expandQuery
 * @param {{headings?:string[], text?:string}} page  parsed page signals (rules.parsePage)
 * @returns {{covered, missing, coverage}} arrays of {type,query,score}
 */
export function coverageGaps(fanout, page = {}) {
  const hay = (((page.headings || []).map((h) => (typeof h === 'string' ? h : h.text)).join(' ')) + ' ' + (page.text || page.bodyText || '')).toLowerCase();
  const covered = [];
  const missing = [];
  for (const sq of fanout.subqueries || []) {
    const terms = sq.query.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
    const hits = terms.filter((t) => hay.includes(t)).length;
    const score = terms.length ? hits / terms.length : 0;
    (score >= 0.6 ? covered : missing).push({ type: sq.type, class: sq.class, query: sq.query, score: Math.round(score * 100) / 100 });
  }
  const total = (fanout.subqueries || []).length;
  return { covered, missing, coverage: total ? Math.round((covered.length / total) * 100) : 0 };
}
