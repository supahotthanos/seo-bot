// seo-bot · rrf — Reciprocal Rank Fusion citation predictor (pre-publish).
//
// 2026 answer engines run the query fan-out (fanout.mjs), retrieve PASSAGES per
// sub-query, and fuse the per-sub-query ranked lists with Reciprocal Rank Fusion
// (Cormack et al., SIGIR 2009): score(d) = Σ 1/(k + rank_i(d)), k=60. k=60 is the
// load-bearing constant — it flattens the gap between rank-1 and rank-5 so a passage
// relevant across MANY sub-queries beats one that is rank-1 for a single sub-query
// (breadth > a single perfect match). The citation maps to the fused winner.
//
// This module pre-flights "will our passage be cited?": for each sub-query it ranks
// OUR candidate passages against COMPETITOR passages by similarity, fuses with RRF,
// and reports whether we win + which sub-queries we lose. NO external embeddings are
// required — the default similarity is a TF-overlap (cosine over term-frequency
// vectors). If a caller supplies an embed function, we use cosine over embeddings
// instead. No SaaS pre-flights this for us. Pure functions, no I/O.

export const RRF_K = 60;

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'is', 'are', 'be', 'with', 'as', 'at', 'by', 'it', 'this', 'that', 'from', 'how', 'much', 'does', 'do', 'what', 'your', 'you', 'we', 'our']);

/** Tokenize to content terms (lowercased, stopworded, length>2). */
function terms(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

/** Term-frequency vector (Map term→count) for a string. */
function tfVector(text) {
  const v = new Map();
  for (const t of terms(text)) v.set(t, (v.get(t) || 0) + 1);
  return v;
}

/** Cosine similarity between two TF Maps (the default, embedding-free, similarity). */
export function tfOverlapSimilarity(a, b) {
  const va = a instanceof Map ? a : tfVector(a);
  const vb = b instanceof Map ? b : tfVector(b);
  if (!va.size || !vb.size) return 0;
  let dot = 0;
  for (const [t, w] of va) { const wb = vb.get(t); if (wb) dot += w * wb; }
  let na = 0; for (const w of va.values()) na += w * w;
  let nb = 0; for (const w of vb.values()) nb += w * w;
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Cosine similarity over two numeric embedding vectors. */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/**
 * Rank candidate passages against one sub-query by similarity (descending).
 * @returns Array<{id, owner, sim, rank}> rank is 1-based.
 */
function rankForQuery(subquery, passages, simFn) {
  const qVec = tfVector(subquery);
  const scored = passages.map((p) => ({
    id: p.id,
    owner: p.owner || 'us',
    sim: simFn ? simFn(subquery, p, qVec) : tfOverlapSimilarity(qVec, p._tf || (p._tf = tfVector(p.text))),
  }));
  scored.sort((x, y) => y.sim - x.sim);
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}

/**
 * RRF citation predictor.
 * @param {Array<{id, owner:'us'|'competitor', text, embedding?}>} passages
 *   Candidate passages from OUR page + competitor pages. `owner` defaults to 'us'.
 * @param {Array<{type, query}>|{subqueries}} subqueries  fan-out (fanout.expandQuery output or a list)
 * @param {{embed?, k?}} opts
 *   embed — optional (text)=>number[] embedder; when given, cosine over embeddings
 *           is used instead of the TF-overlap fallback.
 *   k     — RRF constant (default 60).
 * @returns {{k, fused:Array, winner, ourBest, weWin, lostSubqueries, perSubquery}}
 */
export function predictCitation(passages = [], subqueries = [], { embed = null, k = RRF_K } = {}) {
  const subs = Array.isArray(subqueries) ? subqueries : (subqueries.subqueries || []);
  const subList = subs.map((s) => (typeof s === 'string' ? { type: 'query', query: s } : s)).filter((s) => s.query);
  const cands = passages.map((p) => ({ ...p, owner: p.owner || 'us' }));

  // Pre-embed if an embedder is supplied (so similarity is cosine over vectors).
  // Embeddings are cached in a local Map keyed by text so we never mutate the
  // caller-provided passage objects.  If a cand already carries a pre-computed
  // embedding we seed the cache with it so embed() is not called unnecessarily.
  let simFn = null;
  if (embed) {
    const cache = new Map();
    const vec = (text) => { if (!cache.has(text)) cache.set(text, embed(text)); return cache.get(text); };
    // Seed cache from any pre-computed embeddings the caller provided (read-only).
    for (const p of cands) { if (p.embedding) cache.set(p.text, p.embedding); }
    simFn = (q, p) => cosine(vec(q), vec(p.text));
  }

  // RRF accumulation across sub-queries.
  const fused = new Map(); // id → {id, owner, score, ranks:{type:rank}}
  const perSubquery = [];
  for (const sq of subList) {
    const ranked = rankForQuery(sq.query, cands, simFn);
    perSubquery.push({ type: sq.type, query: sq.query, ranking: ranked.map((r) => ({ id: r.id, owner: r.owner, rank: r.rank, sim: Math.round(r.sim * 1000) / 1000 })) });
    for (const r of ranked) {
      const cur = fused.get(r.id) || { id: r.id, owner: r.owner, score: 0, ranks: {} };
      cur.score += 1 / (k + r.rank);
      cur.ranks[sq.query] = r.rank; // key by the unique query — multiple sub-queries can share a type (e.g. "comparison")
      fused.set(r.id, cur);
    }
  }

  const fusedArr = [...fused.values()].map((f) => ({ ...f, score: Math.round(f.score * 1e6) / 1e6 })).sort((a, b) => b.score - a.score);
  const winner = fusedArr[0] || null;
  const ourBest = fusedArr.find((f) => f.owner === 'us') || null;
  const weWin = !!winner && winner.owner === 'us';

  // Sub-queries where a competitor outranks our best passage (the gaps to close).
  const lostSubqueries = [];
  for (const ps of perSubquery) {
    const ourTop = ps.ranking.filter((r) => r.owner === 'us').reduce((a, b) => (a && a.rank <= b.rank ? a : b), null);
    const compTop = ps.ranking.filter((r) => r.owner === 'competitor').reduce((a, b) => (a && a.rank <= b.rank ? a : b), null);
    if (compTop && (!ourTop || compTop.rank < ourTop.rank)) {
      lostSubqueries.push({ type: ps.type, query: ps.query, ourRank: ourTop?.rank ?? null, competitorRank: compTop.rank, competitorId: compTop.id });
    }
  }

  return { k, fused: fusedArr, winner, ourBest, weWin, lostSubqueries, perSubquery };
}
