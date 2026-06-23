// seo-bot · pagerank-weighted — weighted "reasonable surfer" PageRank.
//
// Classic PageRank (links.mjs) assumes a surfer who clicks every link on a page with
// EQUAL probability. Google's reasonable-surfer model (US Patent 7,716,225) says the
// surfer is far likelier to click a prominent, in-body, descriptive link than a
// boilerplate footer link. So equity should flow along edges PROPORTIONALLY to a
// per-link weight, not 1/outdegree. This module implements that.
//
// Per-edge weight = region × position × anchorLength × relevance, each derived during
// the cheerio pass (see buildWeightedGraph below):
//   • region    — body link ≫ nav/sidebar ≫ footer (boilerplate). The single biggest lever.
//   • position  — earlier-in-DOM links get more clicks (top-of-page bias).
//   • anchor    — a descriptive multi-word anchor beats a one-word/generic one.
//   • relevance — optional topical similarity (mesh.mjs supplies it); 1 when unknown.
//
// Additive to links.mjs: that file's unweighted pagerank() stays as-is. This is the
// drop-in replacement the sculptor (sculpt.mjs) ranks money pages against.

/** Region multipliers for the reasonable surfer (body links carry most click-equity). */
export const REGION_WEIGHT = { body: 1.0, main: 1.0, content: 1.0, aside: 0.35, sidebar: 0.35, nav: 0.2, header: 0.2, footer: 0.1, unknown: 0.6 };

/** Map an element's nearest landmark ancestor / ARIA role to a region bucket. */
export function regionOf($, el) {
  // Walk ancestors looking for a semantic landmark or a role/class hint. Cheap and robust.
  let node = el;
  for (let depth = 0; node && depth < 25; depth++) {
    const tag = (node.tagName || node.name || '').toLowerCase();
    if (tag === 'footer') return 'footer';
    if (tag === 'nav') return 'nav';
    if (tag === 'header') return 'header';
    if (tag === 'aside') return 'sidebar';
    if (tag === 'main' || tag === 'article') return 'body';
    const role = (node.attribs?.role || '').toLowerCase();
    if (role === 'contentinfo') return 'footer';
    if (role === 'navigation') return 'nav';
    if (role === 'banner') return 'header';
    if (role === 'complementary') return 'sidebar';
    if (role === 'main') return 'body';
    const cls = (node.attribs?.class || '').toLowerCase();
    if (/\bfooter\b/.test(cls)) return 'footer';
    if (/\b(nav|navbar|menu)\b/.test(cls)) return 'nav';
    if (/\b(sidebar|aside|widget)\b/.test(cls)) return 'sidebar';
    if (/\b(content|article|post|entry|main)\b/.test(cls)) return 'body';
    node = node.parent;
  }
  return 'unknown';
}

/** Position factor: links earlier in the document attract more clicks (DOM-order proxy). */
export function positionFactor(index, total) {
  if (!total || total <= 1) return 1;
  // Linear top-bias from 1.0 (first link) down to 0.5 (last link).
  return 1 - 0.5 * (index / (total - 1));
}

/** Anchor-length factor: a descriptive 2–6-word anchor > generic/one-word; clamp the tail. */
export function anchorFactor(anchorText) {
  const words = (anchorText || '').trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0.4;            // image/empty anchor — weak click signal
  if (words === 1) return 0.7;
  if (words <= 6) return 1.0;             // the descriptive sweet spot
  return 0.85;                            // very long anchors dilute
}

/**
 * Compute a single edge weight from its components. relevance defaults to 1 (unknown).
 * @returns {number} a strictly-positive weight.
 */
export function edgeWeight({ region = 'unknown', positionIdx = 0, positionTotal = 1, anchorText = '', relevance = 1 } = {}) {
  const w = (REGION_WEIGHT[region] ?? REGION_WEIGHT.unknown)
    * positionFactor(positionIdx, positionTotal)
    * anchorFactor(anchorText)
    * Math.max(0.05, relevance);
  return Math.max(1e-4, w); // never zero (a zero-weight edge would silently vanish)
}

/**
 * Weighted PageRank via power iteration.
 * @param {Map<string, Map<string, number>>} graph  src → (tgt → weight). Weights need not be normalized.
 * @param {{alpha?:number, iters?:number, tol?:number}} [opts]
 * @returns {{pr:Map, inlinks:Map, outWeight:Map}} pr = url→score (sums to 1).
 *
 * Equity from src splits across its out-edges PROPORTIONALLY to weight (not 1/outdeg).
 * Dangling nodes (no out-edges) redistribute uniformly, exactly like classic PageRank.
 */
export function weightedPageRank(graph, { alpha = 0.85, iters = 60, tol = 1e-9 } = {}) {
  const nodes = [...graph.keys()];
  const N = nodes.length || 1;
  const outWeight = new Map(nodes.map((n) => [n, [...graph.get(n).values()].reduce((s, w) => s + w, 0)]));
  // Reverse index: for each target, the list of {src, w} edges pointing at it.
  const inlinks = new Map(nodes.map((n) => [n, []]));
  for (const [src, tgts] of graph) for (const [t, w] of tgts) if (inlinks.has(t)) inlinks.get(t).push({ src, w });

  let pr = new Map(nodes.map((n) => [n, 1 / N]));
  for (let it = 0; it < iters; it++) {
    let dangling = 0;
    for (const n of nodes) if ((outWeight.get(n) || 0) === 0) dangling += pr.get(n);
    const next = new Map();
    let delta = 0;
    for (const n of nodes) {
      let sum = 0;
      for (const { src, w } of inlinks.get(n)) {
        const ow = outWeight.get(src) || 0;
        if (ow > 0) sum += (pr.get(src) * w) / ow;
      }
      const val = (1 - alpha) / N + alpha * (sum + dangling / N);
      next.set(n, val);
      delta += Math.abs(val - pr.get(n));
    }
    pr = next;
    if (delta < tol) break; // converged
  }
  return { pr, inlinks, outWeight };
}

/**
 * Build a weighted internal-link graph from already-fetched pages, computing each edge's
 * reasonable-surfer weight during the cheerio pass. Pure (no I/O) so it's unit-testable.
 *
 * @param {Array<{url?:string, finalUrl?:string, ok?:boolean, html?:string}>} pages
 * @param {object} cfg  client config (uses cfg.baseUrl for same-site checks)
 * @param {object} deps { cheerio, absUrl, sameSite }  — injected to keep this module dep-light
 * @param {(src:string,tgt:string)=>number} [relevanceFn]  optional 0..1 topical similarity (mesh.mjs)
 * @returns {{graph:Map<string,Map<string,number>>, edges:Array, inSet:Set, norm:(u:string)=>string}}
 */
export function buildWeightedGraph(pages, cfg, { cheerio, absUrl, sameSite }, relevanceFn = null) {
  const norm = (u) => (u || '').split('#')[0].replace(/\/$/, '');
  const inSet = new Set(pages.filter((p) => p.ok).map((p) => norm(p.finalUrl || p.url)));
  const graph = new Map([...inSet].map((u) => [u, new Map()]));
  const edges = [];

  for (const pg of pages) {
    if (!pg.ok) continue;
    const from = norm(pg.finalUrl || pg.url);
    const $ = cheerio.load(pg.html || '');
    const anchors = $('a[href]').toArray();
    const total = anchors.length;
    anchors.forEach((el, idx) => {
      const abs = absUrl(pg.finalUrl || pg.url, $(el).attr('href'));
      if (!abs || !sameSite(abs, cfg.baseUrl)) return;
      const t = norm(abs);
      if (t === from || !inSet.has(t)) return;
      const anchorText = ($(el).text() || '').replace(/\s+/g, ' ').trim();
      const region = regionOf($, el);
      const relevance = relevanceFn ? relevanceFn(from, t) : 1;
      const w = edgeWeight({ region, positionIdx: idx, positionTotal: total, anchorText, relevance });
      // Accumulate parallel edges (same src→tgt linked twice) by summing weight.
      const m = graph.get(from);
      m.set(t, (m.get(t) || 0) + w);
      edges.push({ src: from, tgt: t, region, weight: w, anchorText });
    });
  }
  return { graph, edges, inSet, norm };
}
