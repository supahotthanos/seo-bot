// seo-bot · measure/query-bank-analytics — the QUANT layer over the panel of AI answers.
//
// Given the append-only panel of observations (one row per capture, stamped with engine / spelling
// variant / tier / city / day / ranked-list / citations), answer the questions a data scientist asks:
//   • rankStability   — who ranks, how often, at what mean rank, and how NOISY is that rank (sd)?
//   • varianceByFactor— decompose the variation: does the ranking move more with the DAY, the SPELLING
//                       of the prompt, or the ENGINE? (hold the other factors fixed, measure churn)
//   • shareOfVoice    — how often does OUR client surface, at what rank, per engine?
//   • citationLeaders — which domains does each engine pull from most?
//   • cellVolatility  — per prompt×city, how trustworthy is a single sample vs. a jittery one?
//
// PURE + testable. Similarity of two rankings = Jaccard overlap of the top-K brand sets (robust to
// different-length answers) plus an order-agreement score. Fail-closed: rows without an ok ranked
// list are excluded; never fabricate a comparison from a single sample.

import { canonicalBrand, unifyBrands } from './query-bank.mjs';
import { bootstrapCI, wilsonCI } from '../stats/significance.mjs';

const hostOf = (u = '') => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const dayOf = (iso = '') => String(iso || '').slice(0, 10); // YYYY-MM-DD
const okRows = (obs) => (obs || []).filter((o) => o && o.status === 'ok' && Array.isArray(o.ranked) && o.ranked.length);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

/** PURE: top-K canonical brand names of a ranked list (deduped, order preserved). */
export function topBrands(ranked = [], k = 5) {
  const out = []; const seen = new Set();
  for (const r of ranked.slice().sort((a, b) => (a.rank || 99) - (b.rank || 99))) {
    const b = canonicalBrand(r.name); if (!b || seen.has(b)) continue; seen.add(b); out.push(b); if (out.length >= k) break;
  }
  return out;
}

/** PURE: Jaccard overlap of two brand sets. 1 = identical players, 0 = disjoint. Two empties = 1. */
export function jaccard(a = [], b = []) {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 1;
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni ? inter / uni : 1;
}

/** PURE: order-agreement on the SHARED brands of two ranked lists — 1 = same relative order, 0 =
 *  fully inverted. Ignores brands not in both (Jaccard already measures set overlap). */
export function orderAgreement(rankedA = [], rankedB = []) {
  const posA = new Map(topBrands(rankedA, 50).map((b, i) => [b, i]));
  const posB = new Map(topBrands(rankedB, 50).map((b, i) => [b, i]));
  const shared = [...posA.keys()].filter((b) => posB.has(b));
  if (shared.length < 2) return shared.length === 1 ? 1 : null; // <2 shared → no order to compare
  let concordant = 0, total = 0;
  for (let i = 0; i < shared.length; i++) for (let j = i + 1; j < shared.length; j++) {
    total++;
    const a = posA.get(shared[i]) - posA.get(shared[j]);
    const b = posB.get(shared[i]) - posB.get(shared[j]);
    if ((a < 0 && b < 0) || (a > 0 && b > 0)) concordant++;
  }
  return total ? concordant / total : null; // fraction of pairs in the same order (Kendall-style)
}

// Which dims are held fixed (the control key) and which one VARIES, per factor. 'day' is derived from
// capturedAt; 'variant'/'engine' hold the day fixed so we isolate spelling / engine cleanly.
const CONTROL = {
  day: { key: (o) => [o.engine, o.queryId, o.variantId, o.tier, o.city].join('|'), val: (o) => dayOf(o.capturedAt) },
  variant: { key: (o) => [o.engine, o.queryId, o.tier, o.city, dayOf(o.capturedAt)].join('|'), val: (o) => o.variantId },
  engine: { key: (o) => [o.queryId, o.variantId, o.tier, o.city, dayOf(o.capturedAt)].join('|'), val: (o) => o.engine },
};

/** PURE: decompose ranking variance by ONE factor. Holds every other dimension fixed, then measures
 *  how much the top-K ranked set churns as that factor changes. meanChurn = 1 − meanOverlap; a HIGH
 *  churn means that factor moves the answer a lot. Needs ≥2 factor-values within a control group. */
export function varianceByFactor(observations = [], factor = 'variant', { topK = 5 } = {}) {
  const spec = CONTROL[factor];
  if (!spec) return { factor, status: 'bad-factor', comparisons: 0 };
  const ok = okRows(observations);
  const groups = new Map(); // controlKey -> Map(factorValue -> latest obs)
  for (const o of ok) {
    const ck = spec.key(o), fv = String(spec.val(o) ?? '');
    const g = groups.get(ck) || new Map();
    const prev = g.get(fv);
    if (!prev || String(o.capturedAt || '') >= String(prev.capturedAt || '')) g.set(fv, o); // latest wins
    groups.set(ck, g);
  }
  let sumJ = 0, nJ = 0, sumOrd = 0, nOrd = 0; const byGroup = [];
  for (const [ck, g] of groups) {
    if (g.size < 2) continue;
    const entries = [...g.entries()];
    let gJ = 0, gN = 0;
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      const ji = jaccard(topBrands(entries[i][1].ranked, topK), topBrands(entries[j][1].ranked, topK));
      gJ += ji; gN++; sumJ += ji; nJ++;
      const oa = orderAgreement(entries[i][1].ranked, entries[j][1].ranked);
      if (oa != null) { sumOrd += oa; nOrd++; }
    }
    const meanJ = gN ? gJ / gN : 1;
    byGroup.push({ control: ck, factorValues: entries.map((e) => e[0]), overlap: +meanJ.toFixed(3), churn: +(1 - meanJ).toFixed(3), comparisons: gN });
  }
  byGroup.sort((a, b) => b.churn - a.churn);
  const meanOverlap = nJ ? sumJ / nJ : null;
  const meanChurn = meanOverlap == null ? null : 1 - meanOverlap;
  const orderAgree = nOrd ? sumOrd / nOrd : null;
  // "movement" = how much this factor changes the answer overall: roster change (churn) PLUS a
  // half-weighted penalty for reordering the SAME brands (a #1↔#2 swap is real movement, milder than
  // a roster change). This is what `dominant` ranks on, so a purely-reordering factor still registers.
  const movement = meanChurn == null ? null : meanChurn + 0.5 * (orderAgree == null ? 0 : 1 - orderAgree);
  return {
    factor, status: nJ ? 'ok' : 'insufficient', comparisons: nJ, topK,
    meanOverlap: meanOverlap == null ? null : +meanOverlap.toFixed(3),
    meanChurn: meanChurn == null ? null : +meanChurn.toFixed(3),
    orderAgreement: orderAgree == null ? null : +orderAgree.toFixed(3),
    movement: movement == null ? null : +movement.toFixed(3),
    byGroup,
  };
}

/** PURE: run varianceByFactor for all three levers → the decomposition table + which factor dominates. */
export function varianceDecomposition(observations = [], { topK = 5 } = {}) {
  const factors = ['day', 'variant', 'engine'].map((f) => varianceByFactor(observations, f, { topK }));
  const ranked = factors.filter((f) => f.status === 'ok').sort((a, b) => (b.movement ?? -1) - (a.movement ?? -1));
  return { topK, factors, dominant: ranked[0]?.factor || null };
}

/** PURE: who ranks, how often, at what mean rank, and how noisy (sd). by='brand' = cross-city (chains
 *  merged); by='cityBrand' = per city. appearanceRate is against the obs count in the relevant scope. */
export function rankStability(observations = [], { topK = 10, engine = null, by = 'brand' } = {}) {
  const ok = okRows(observations).filter((o) => !engine || o.engine === engine);
  const obsPerCity = new Map();
  for (const o of ok) obsPerCity.set(o.city, (obsPerCity.get(o.city) || 0) + 1);
  const unify = unifyBrands(ok.flatMap((o) => o.ranked.map((r) => r.name)));
  const acc = new Map();
  for (const o of ok) {
    const seenThisObs = new Set();
    for (const r of o.ranked) {
      if ((r.rank || 99) > topK) continue;
      const root = unify.get(r.name) || canonicalBrand(r.name);
      const gk = by === 'cityBrand' ? `${o.city}::${root}` : root;
      const rec = acc.get(gk) || { brand: root, display: r.name, city: by === 'cityBrand' ? o.city : null, ranks: [], cities: new Set(), n: 0 };
      if (!seenThisObs.has(gk)) { rec.n++; seenThisObs.add(gk); } // count each brand once per observation
      rec.ranks.push(r.rank || topK); rec.cities.add(o.city);
      if (String(r.name).length < String(rec.display).length) rec.display = r.name; // prefer the clean short label
      acc.set(gk, rec);
    }
  }
  const rows = [...acc.values()].map((r) => {
    // mean rank carries a bootstrap CI (≥4 samples) so no naked point estimate ships; appearanceRate
    // carries a Wilson CI on (appearances / obs-in-city). n is always the denominator.
    const b = r.ranks.length >= 4 ? bootstrapCI(r.ranks, { reps: 1000 }) : null;
    const denom = by === 'cityBrand' ? (obsPerCity.get(r.city) || 0) : null;
    const rateCi = denom ? wilsonCI(r.n, denom) : null;
    return {
      brand: r.brand, display: r.display, city: r.city,
      appearances: r.n, n: r.ranks.length,
      meanRank: +mean(r.ranks).toFixed(2), meanRankCi: b ? [+b.lo.toFixed(2), +b.hi.toFixed(2)] : null,
      sdRank: +sd(r.ranks).toFixed(2), bestRank: Math.min(...r.ranks), cityCount: r.cities.size,
      appearanceRate: denom ? +(r.n / denom).toFixed(2) : null,
      appearanceRateCi: rateCi ? [+rateCi[0].toFixed(2), +rateCi[1].toFixed(2)] : null,
    };
  });
  rows.sort((a, b) => b.appearances - a.appearances || a.meanRank - b.meanRank);
  return rows;
}

/** PURE: client visibility. brand = string (matched via canonicalBrand/token-prefix) or predicate.
 *  Returns overall + per-engine + per-city appearance rate and mean rank when present. */
export function shareOfVoice(observations = [], brand = '', { topK = 10 } = {}) {
  const matchFn = typeof brand === 'function' ? brand : (() => {
    const target = canonicalBrand(brand);
    return (name) => { const c = canonicalBrand(name); return !!target && (c === target || c.startsWith(target + ' ') || target.startsWith(c + ' ')); };
  })();
  const ok = okRows(observations);
  const bucket = () => ({ obs: 0, hits: 0, ranks: [] });
  const overall = bucket(), byEngine = new Map(), byCity = new Map();
  for (const o of ok) {
    const hitRank = o.ranked.filter((r) => (r.rank || 99) <= topK).find((r) => matchFn(r.name))?.rank || null;
    for (const b of [overall, byEngine.get(o.engine) || byEngine.set(o.engine, bucket()).get(o.engine), byCity.get(o.city) || byCity.set(o.city, bucket()).get(o.city)]) {
      b.obs++; if (hitRank) { b.hits++; b.ranks.push(hitRank); }
    }
  }
  // Every appearance rate carries a Wilson CI + its denominator (n) — no naked share ships (criterion 2).
  const fin = (b) => { const [lo, hi] = wilsonCI(b.hits, b.obs); return { observations: b.obs, n: b.obs, appearances: b.hits, appearanceRate: b.obs ? +(b.hits / b.obs).toFixed(3) : 0, ci: [+lo.toFixed(3), +hi.toFixed(3)], meanRank: b.ranks.length ? +mean(b.ranks).toFixed(2) : null }; };
  return {
    brand: typeof brand === 'string' ? brand : '(predicate)',
    overall: fin(overall),
    byEngine: [...byEngine.entries()].map(([engine, b]) => ({ engine, ...fin(b) })).sort((a, b) => b.appearanceRate - a.appearanceRate),
    byCity: [...byCity.entries()].map(([city, b]) => ({ city, ...fin(b) })).sort((a, b) => b.appearanceRate - a.appearanceRate),
  };
}

/** PURE: which domains each engine pulls from most across the panel. */
export function citationLeaders(observations = [], { engine = null, topK = 40 } = {}) {
  const ok = okRows(observations).filter((o) => !engine || o.engine === engine);
  const dom = new Map();
  for (const o of ok) for (const u of (o.citations?.urls || [])) {
    const d = hostOf(u); if (!d) continue;
    const rec = dom.get(d) || { domain: d, cites: 0, cities: new Set(), queries: new Set(), engines: new Set() };
    rec.cites++; rec.cities.add(o.city); rec.queries.add(o.queryId); rec.engines.add(o.engine); dom.set(d, rec);
  }
  return [...dom.values()].map((r) => ({ domain: r.domain, cites: r.cites, cityCount: r.cities.size, queryCount: r.queries.size, engineCount: r.engines.size }))
    .sort((a, b) => b.cites - a.cites || b.cityCount - a.cityCount).slice(0, topK);
}

/** PURE: per prompt×city volatility — 1 − mean pairwise top-K overlap across that cell's REPEAT samples
 *  (across days/runs). High = a single sample is untrustworthy. Needs ≥2 samples in a cell. */
export function cellVolatility(observations = [], { topK = 5 } = {}) {
  const ok = okRows(observations);
  const cells = new Map();
  for (const o of ok) { const k = [o.engine, o.queryId, o.variantId, o.tier, o.city].join('|'); (cells.get(k) || cells.set(k, []).get(k)).push(o); }
  const out = [];
  for (const [k, list] of cells) {
    if (list.length < 2) continue;
    let s = 0, n = 0;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { s += jaccard(topBrands(list[i].ranked, topK), topBrands(list[j].ranked, topK)); n++; }
    const overlap = n ? s / n : 1;
    const [engine, queryId, variantId, tier, city] = k.split('|');
    out.push({ engine, queryId, variantId, tier, city, samples: list.length, overlap: +overlap.toFixed(3), volatility: +(1 - overlap).toFixed(3) });
  }
  return out.sort((a, b) => b.volatility - a.volatility);
}

/** PURE: panel summary — counts + date range + which dims are covered (so the report is honest about
 *  what CAN be measured; variance factors need ≥2 values). */
export function panelSummary(observations = []) {
  const ok = okRows(observations);
  const S = (f) => new Set(ok.map(f).filter((x) => x != null && x !== ''));
  const days = S((o) => dayOf(o.capturedAt));
  return {
    observations: ok.length, excluded: (observations || []).length - ok.length,
    engines: [...S((o) => o.engine)], cities: [...S((o) => o.city)], queries: [...S((o) => o.queryId)],
    variants: [...S((o) => o.variantId)], tiers: [...S((o) => o.tier)], days: [...days].sort(),
    canMeasure: { day: days.size >= 2, spelling: S((o) => o.variantId).size >= 2, engine: S((o) => o.engine).size >= 2 },
  };
}

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
// Cells that never ship a naked estimate: mean rank always shows its CI (or n= when too few samples),
// a rate always shows its CI + denominator.
const rankCell = (r) => (r.meanRank == null ? '—' : (r.meanRankCi ? `${r.meanRank} [${r.meanRankCi[0]}–${r.meanRankCi[1]}]` : `${r.meanRank} (n=${r.n})`));
const rateCell = (rate, ci, n) => (rate == null ? '—' : (ci ? `${pct(rate)} [${pct(ci[0])}–${pct(ci[1])}] (n=${n})` : `${pct(rate)} (n=${n})`));

/** Build the Peec-style markdown report from the panel. clientBrand (optional) drives share-of-voice. */
/** PURE: which model actually served each answer, and where the REGIME BOUNDARIES are.
 *  Identity = sturm.resolvedModelSlug (the truth — routing silently swaps models under a
 *  stable UI label) > row.model (UI label) > '(unlabeled)'. A day whose dominant model
 *  differs from the previous day's starts a new regime; metrics must never be trended
 *  across an un-annotated boundary (documented live: the Mar-4-2026 swap moved avg cited
 *  domains −20% overnight). Operator order 2026-07-26: "models change pretty fast —
 *  break down what models we're retrieving for med-spa searches." */
export function modelMix(rows = []) {
  const ident = (r) => r?.sturm?.resolvedModelSlug || r?.model || '(unlabeled)';
  const ok = rows.filter((r) => r && r.status === 'ok');
  const byModel = new Map();
  const byDay = new Map();
  for (const r of ok) {
    const m = ident(r);
    const e = byModel.get(m) || { model: m, n: 0, firstDay: r.day || '', lastDay: r.day || '' };
    e.n += 1;
    if (r.day) {
      if (!e.firstDay || r.day < e.firstDay) e.firstDay = r.day;
      if (r.day > e.lastDay) e.lastDay = r.day;
    }
    byModel.set(m, e);
    if (r.day) { const d = byDay.get(r.day) || new Map(); d.set(m, (d.get(m) || 0) + 1); byDay.set(r.day, d); }
  }
  const models = [...byModel.values()].sort((a, b) => b.n - a.n)
    .map((e) => ({ ...e, share: ok.length ? e.n / ok.length : 0 }));
  const regimes = [];
  let prev = null;
  for (const day of [...byDay.keys()].sort()) {
    const top = [...byDay.get(day).entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0][0];
    if (top !== prev) { regimes.push({ day, model: top }); prev = top; }
  }
  return { sampled: ok.length, models, regimes };
}

export function buildQueryBankReport(observations = [], { generatedAt = '', clientBrand = '' } = {}) {
  const sum = panelSummary(observations);
  const decomp = varianceDecomposition(observations, { topK: 5 });
  const L = [
    '# In-house AI Query Bank — the panel & its variance', '',
    '> Every row is one captured AI answer, stamped with engine · spelling variant · tier · city · day.',
    '> This report decomposes how the ranking moves with each lever, and tracks who ranks where.', '',
    `**Observations:** ${sum.observations} (excluded ${sum.excluded})  ·  **engines:** ${sum.engines.join(', ') || '—'}  ·  **cities:** ${sum.cities.length}  ·  **queries:** ${sum.queries.join(', ') || '—'}  ·  **variants:** ${sum.variants.length}  ·  **days:** ${sum.days.length}`,
    `**generated:** ${generatedAt}`, '',
    '## 🎛️ Variance decomposition — what moves the ranking?', '',
    '_Overlap = mean Jaccard of the top-5 brands when only that factor changes (everything else held fixed). Churn = 1 − overlap. Movement = churn + reordering penalty; `dominant` ranks on movement._', '',
    '| factor | comparisons | top-5 overlap | churn | order-agreement | movement | measurable? |',
    '|--------|-------------|---------------|-------|-----------------|----------|-------------|',
    ...decomp.factors.map((f) => `| ${f.factor}${decomp.dominant === f.factor ? ' **⟵ dominant**' : ''} | ${f.comparisons} | ${pct(f.meanOverlap)} | ${pct(f.meanChurn)} | ${pct(f.orderAgreement)} | ${f.movement == null ? '—' : f.movement} | ${sum.canMeasure[f.factor === 'variant' ? 'spelling' : f.factor] ? 'yes' : 'need ≥2'} |`),
    '',
    decomp.dominant ? `**Read:** \`${decomp.dominant}\` is the biggest source of ranking variation in the panel so far.` : '_Not enough repeated samples yet to attribute variance — accrues as the bank runs across days/variants/engines._',
    '',
  ];

  // Model mix — which model is ACTUALLY answering, and where the regime boundaries sit.
  const mm = modelMix(observations);
  if (mm.sampled) {
    L.push('## 🤖 Model mix — which model is actually answering', '',
      '_Identity = `resolved_model_slug` when captured (the truth), else the UI model label. A dominant-model switch is a REGIME BOUNDARY: comparisons that span one measure the model swap, not the market._', '',
      '| model (resolved) | rows | share | first seen | last seen |', '|------------------|------|-------|------------|-----------|',
      ...mm.models.map((m) => `| \`${m.model}\` | ${m.n} | ${pct(m.share)} | ${m.firstDay || '—'} | ${m.lastDay || '—'} |`), '');
    if (mm.regimes.length > 1) {
      L.push('**Regime boundaries (dominant model switched):** ' + mm.regimes.map((r) => `${r.day} → \`${r.model}\``).join(' · '), '');
    }
  }

  // Spelling spotlight — for each city, does the #1 change with the wording? (only if spelling measurable)
  if (sum.canMeasure.spelling) {
    L.push('## ✍️ Spelling sensitivity — does the wording change #1?', '');
    const ok = okRows(observations);
    const byCity = new Map();
    for (const o of ok) { const m = byCity.get(o.city) || new Map(); const top = topBrands(o.ranked, 1)[0]; if (top) { const s = m.get(o.variantId) || top; m.set(o.variantId, top); } byCity.set(o.city, m); }
    L.push('| city | #1 by variant |', '|------|---------------|');
    for (const [city, m] of byCity) {
      const parts = [...m.entries()].map(([v, top]) => `${v}: ${top}`);
      const distinct = new Set(m.values()).size;
      L.push(`| ${city}${distinct > 1 ? ' ⚠️' : ''} | ${parts.join(' · ')} |`);
    }
    L.push('', '_⚠️ = the top pick changes with the spelling — the ranking is phrasing-sensitive here._', '');
  }

  // Per-city leaderboard
  L.push('## 🥇 Leaderboard — who ranks per city', '');
  const cityRows = rankStability(observations, { topK: 10, by: 'cityBrand' });
  const cities = [...new Set(cityRows.map((r) => r.city))];
  for (const city of cities) {
    L.push(`### ${city}`, '', '| brand | mean rank [95% CI] | sd | appears | rate [95% CI] |', '|-------|--------------------|----|---------|----------------|');
    for (const r of cityRows.filter((x) => x.city === city).slice(0, 10)) L.push(`| ${r.display} | ${rankCell(r)} | ${r.sdRank} | ${r.appearances} | ${rateCell(r.appearanceRate, r.appearanceRateCi, r.n)} |`);
    L.push('');
  }

  // Cross-city "ranks most"
  L.push('## 📈 Brands ChatGPT/engines rank most (chains merged, across cities)', '', '| brand | # cities | mean rank [95% CI] | sd | appearances |', '|-------|----------|--------------------|----|-------------|');
  for (const r of rankStability(observations, { topK: 10, by: 'brand' }).slice(0, 30)) L.push(`| ${r.display} | ${r.cityCount} | ${rankCell(r)} | ${r.sdRank} | ${r.appearances} |`);
  L.push('');

  // Share of voice (optional) — every rate with its CI + denominator.
  if (clientBrand) {
    const sov = shareOfVoice(observations, clientBrand, { topK: 10 });
    L.push(`## 📣 Share of voice — "${clientBrand}"`, '', `**Overall visibility / share of voice:** appears in ${rateCell(sov.overall.appearanceRate, sov.overall.ci, sov.overall.n)} of answers${sov.overall.meanRank ? `, mean rank ${sov.overall.meanRank}` : ''}.`, '');
    if (sov.byEngine.length) { L.push('| engine | appearance rate [95% CI] | mean rank |', '|--------|--------------------------|-----------|'); for (const e of sov.byEngine) L.push(`| ${e.engine} | ${rateCell(e.appearanceRate, e.ci, e.n)} | ${e.meanRank ?? '—'} |`); L.push(''); }
  }

  // Citation leaders
  L.push('## 🔗 Top sites the engines pull from', '', '| # | domain | citations | # cities | # queries |', '|---|--------|-----------|----------|-----------|');
  citationLeaders(observations, { topK: 30 }).forEach((d, i) => L.push(`| ${i + 1} | ${d.domain} | ${d.cites} | ${d.cityCount} | ${d.queryCount} |`));
  L.push('');

  // Volatility watchlist
  const vol = cellVolatility(observations, { topK: 5 }).filter((v) => v.samples >= 2);
  if (vol.length) {
    L.push('## 🌪️ Volatility watchlist — prompts where a single sample is unreliable', '', '| engine | query | variant | city | samples | volatility |', '|--------|-------|---------|------|---------|------------|');
    for (const v of vol.slice(0, 20)) L.push(`| ${v.engine} | ${v.queryId} | ${v.variantId} | ${v.city} | ${v.samples} | ${pct(v.volatility)} |`);
    L.push('');
  }
  return L.join('\n');
}
