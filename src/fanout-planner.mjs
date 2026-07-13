// seo-bot · fanout-planner — Epic E3: fan-out coverage planner (retrieval Layer 1).
//
// "Coverage beats peak rank": 2026 answer engines decompose one prompt into ~8-15
// sub-queries, retrieve per sub-query, and RRF-fuse (k=60 flattens rank-1 vs rank-5) —
// so ranking #4-8 across 30 sub-queries beats #1 for 3. This module builds the
// coverage MATRIX: target queries × their fan-out sub-queries × our money pages,
// marks covered/uncovered cells (explicit threshold), and turns uncovered cells into
// brief STUBS that ride the EXISTING content brief → anti-slop gate path (a stub
// never drafts anything; it refuses until a human fills real data points).
//
// Sub-query provenance is never blended silently:
//   source:'captured'  — REAL sub-queries recorded off the engines by
//                        measure/fanout-capture.mjs (only status==='ok' rows count;
//                        blocked/empty captures are EXCLUDED, fail-closed).
//   source:'synthetic' — the 2026 modifier set (best/top/reviews/cost/price/how much/
//                        near me/<year>/vs/safe/before-after/board-certified) plus
//                        service×city crossings from the client config.
// A query's fan-out is EITHER captured OR synthetic — never a silent mix.
//
// Reuses (does not fork): rrf.mjs predictCitation + RRF_K (k=60), fanout.mjs
// salientEntity, content/terms.mjs tokenize + STOPWORDS (the TF/term-overlap
// machinery), content/index.mjs capProgrammatic (June-2026 scaled-content guard),
// content/templates.mjs CONTENT_TEMPLATES.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { ROOT } from './config.mjs';
import { nowIso, slugify } from './util.mjs';
import { predictCitation, tfOverlapSimilarity } from './rrf.mjs';
import { salientEntity } from './fanout.mjs';
import { tokenize, STOPWORDS } from './content/terms.mjs';
import { capProgrammatic } from './content/index.mjs';
import { CONTENT_TEMPLATES } from './content/templates.mjs';

/** A cell is covered when >= this fraction of the sub-query's content terms appear on the page. */
export const COVERAGE_THRESHOLD = 0.6;
/** The ~8-15 sub-queries a 2026 engine fans out to (Google AI Mode / ChatGPT search). */
export const SUBQUERY_MIN = 8;
export const SUBQUERY_MAX = 15;

/** Evidence note for the report — tiered, with a pointer into research/ (no folklore). */
export const EVIDENCE = {
  claim: 'A page answering the main query PLUS >=1 fan-out sub-query has ~+161% citation odds vs answering the main query alone; one prompt fans out to ~9-11 sub-queries.',
  source: 'Metehan Yeşilyurt (metehan.ai, Peec AI GEO researcher) fan-out analysis; same figure carried by iPullRank (Mike King).',
  pointer: 'research/seo-bot-integration-backlog.md ("answer the main query + ≥1 sub-query → +161% citation odds") · research/searchatlas-100x-aeo-engine-plan.md (fan-out simulator note)',
  tier: 'medium', // practitioner/observational study, single-source effect size — not a controlled experiment
};

/** The 2026 synthetic modifier set. `e` = salient entity, `city` = primary service geo. */
export const MODIFIERS_2026 = [
  { type: 'best', tpl: (e, city) => `best ${e}${city ? ` in ${city}` : ''}` },
  { type: 'top', tpl: (e, city) => `top ${e} providers${city ? ` ${city}` : ''}` },
  { type: 'reviews', tpl: (e) => `${e} reviews` },
  { type: 'cost', tpl: (e, city) => `${e} cost${city ? ` ${city}` : ''}` },
  { type: 'price', tpl: (e) => `${e} price` },
  { type: 'how-much', tpl: (e) => `how much does ${e} cost` },
  { type: 'near-me', tpl: (e) => `${e} near me` },
  { type: 'year', tpl: (e) => `${e} ${new Date().getFullYear()}` },
  { type: 'vs', tpl: (e) => `${e} vs alternatives` },
  { type: 'safe', tpl: (e) => `is ${e} safe` },
  { type: 'before-after', tpl: (e) => `${e} before and after results` },
  { type: 'board-certified', tpl: (e, city) => `board-certified ${e} provider${city ? ` ${city}` : ''}` },
];

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Pull the REAL captured sub-queries for one target query out of fanout-capture output.
 * Accepts capturePanel output ({rows:[...]}) or a bare rows array. FAIL-CLOSED: only
 * status==='ok' rows count — blocked / empty / no-input captures are excluded, never
 * treated as "the engine ran no sub-queries".
 */
export function capturedSubqueries(captured, query) {
  if (!captured) return [];
  const rows = Array.isArray(captured) ? captured : Array.isArray(captured.rows) ? captured.rows : [];
  const key = norm(query);
  const seen = new Set([key]); // never include the head query itself as a sub-query cell
  const out = [];
  for (const r of rows) {
    if (!r || r.status !== 'ok') continue; // fail-closed: blocked/empty captures excluded
    if (norm(r.prompt) !== key) continue;
    for (const s of r.subqueries || []) {
      const t = String(s || '').replace(/\s+/g, ' ').trim();
      const k = norm(t);
      if (!t || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

/** Salient entity with the known geo tokens stripped ("botox miami" + Miami → "botox"). */
function entityFor(query, cfg = {}) {
  const raw = salientEntity(query);
  const geoToks = new Set((cfg.serviceAreaGeos || []).concat(cfg.locations?.map((l) => l?.nap?.city) || [])
    .flatMap((g) => norm(g).split(' ')).filter(Boolean));
  const stripped = raw.split(' ').filter((w) => !geoToks.has(norm(w))).join(' ');
  return stripped || raw;
}

/** Synthesize the 2026 modifier fan-out for a query (+ service×city crossings from cfg). */
export function synthesizeSubqueries(query, cfg = {}) {
  const e = entityFor(query, cfg);
  const city = cfg.serviceAreaGeos?.[0] || cfg.locations?.[0]?.nap?.city || '';
  const seen = new Set([norm(query)]);
  const out = [];
  const add = (type, text) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    const k = norm(t);
    if (!t || seen.has(k) || out.length >= SUBQUERY_MAX) return;
    seen.add(k);
    out.push({ type, query: t, source: 'synthetic' });
  };
  for (const m of MODIFIERS_2026) add(m.type, m.tpl(e, city));
  // service × city crossings from the config (the local retrieval cells)
  for (const g of (cfg.serviceAreaGeos || []).slice(0, 3)) {
    add('city', `${e} ${g}`);
    add('city-cost', `${e} cost ${g}`);
  }
  return out.slice(0, SUBQUERY_MAX);
}

/**
 * Enumerate a target query's fan-out: captured (real) if a usable capture exists for
 * that exact prompt, otherwise synthetic. NEVER a silent mix — every sub-query carries
 * its `source` label and the whole set shares one `fanoutSource`.
 */
export function enumerateSubqueries(query, { cfg = {}, captured = null } = {}) {
  const cap = capturedSubqueries(captured, query);
  if (cap.length) {
    const subqueries = cap.slice(0, SUBQUERY_MAX).map((q) => ({ type: 'captured', query: q, source: 'captured' }));
    const r = { fanoutSource: 'captured', subqueries };
    if (subqueries.length < SUBQUERY_MIN) r.note = `captured fan-out has only ${subqueries.length} sub-queries (< ${SUBQUERY_MIN}); NOT padded with synthetic — labels never mix`;
    return r;
  }
  return { fanoutSource: 'synthetic', subqueries: synthesizeSubqueries(query, cfg) };
}

const docText = (d) => {
  const heads = (d.headings || []).map((h) => (typeof h === 'string' ? h : h?.text || '')).join(' ');
  return `${d.title || ''} ${heads} ${d.text || ''}`.replace(/\s+/g, ' ').trim();
};

/**
 * Lexical cell score for (sub-query, page): fraction of the sub-query's content terms
 * present on the page (term-overlap, reusing terms.mjs tokenize+STOPWORDS), plus the
 * rrf.mjs TF-cosine similarity for ranking detail. A sub-query with no content terms
 * scores 0 (fail-closed: unscoreable is NOT covered).
 */
export function scoreCell(subquery, doc = {}) {
  const qTerms = [...new Set(tokenize(subquery).filter((w) => !STOPWORDS.has(w)))];
  const hay = docText(doc).toLowerCase();
  if (!qTerms.length || !hay) return { termCoverage: 0, sim: 0 };
  const hits = qTerms.filter((t) => hay.includes(t)).length;
  return {
    termCoverage: Math.round((hits / qTerms.length) * 100) / 100,
    sim: Math.round(tfOverlapSimilarity(subquery, hay) * 1000) / 1000,
  };
}

/** Explicit threshold check. Non-finite scores are NEVER covered (fail-closed). */
export function isCovered(score) {
  return Number.isFinite(score) && score >= COVERAGE_THRESHOLD;
}

const DEPRECATED_RICH = new Set(['FAQPage', 'HowTo', 'QAPage']); // lost rich results May 2026

const TEMPLATE_BY_TYPE = {
  cost: 'cost_guide', price: 'cost_guide', 'how-much': 'cost_guide', 'city-cost': 'cost_guide',
  vs: 'comparison',
  safe: 'treatment_explainer', 'before-after': 'treatment_explainer', year: 'treatment_explainer',
  best: 'compact_keyword', top: 'compact_keyword', reviews: 'compact_keyword',
  'near-me': 'compact_keyword', 'board-certified': 'compact_keyword', city: 'compact_keyword',
};

function inferTemplate(q) {
  const t = String(q || '').toLowerCase();
  if (/\bvs\b|versus|compare/.test(t)) return 'comparison';
  if (/cost|price|how much/.test(t)) return 'cost_guide';
  if (/what is|how does|guide to|explain|safe|risk/.test(t)) return 'treatment_explainer';
  return 'compact_keyword';
}

/**
 * Brief STUB for one uncovered fan-out cell — the same shape contentDraft writes to
 * reports/<client>/drafts/<slug>.brief.json, so it rides the EXISTING brief → gate path:
 * `content draft <client> "<targetQuery>"` finds this brief and REFUSES to draft until a
 * human/data source fills >=3 REAL dataPoints, a named author, and >=2 primarySources
 * (contentDraft refusal + gates.scoreContent hard gates). dataPoints stays EMPTY here on
 * purpose — placeholders live in dataPointsNeeded so they can never satisfy the gate.
 */
export function briefStub(gap = {}, { cfg = {}, parentQuery = '', fanoutSource = 'synthetic' } = {}) {
  const q = String(gap.query || '').trim();
  const tmplId = TEMPLATE_BY_TYPE[gap.type] || inferTemplate(q);
  const tmpl = CONTENT_TEMPLATES[tmplId] || {};
  const city = cfg.serviceAreaGeos?.[0] || cfg.locations?.[0]?.nap?.city || '';
  const entity = entityFor(parentQuery || q, cfg);
  return {
    slug: slugify(q),
    template: tmplId,
    local: tmplId === 'compact_keyword',
    neighborhoods: cfg.neighborhoods || [],
    title: q,
    targetQuery: q.toLowerCase(),
    parentQuery,
    city,
    ymyl: tmpl.ymyl !== false,
    author: { name: '', role: '' },
    // ANTI-SLOP CONTRACT: stays empty — drafting is refused until a human fills REAL data.
    dataPoints: [],
    dataPointsNeeded: [
      `REQUIRED (human/data): real price or number for "${entity}"${city ? ` in ${city}` : ''} — from the clinic's own price list / booking system, never invented`,
      `REQUIRED (human/data): one primary-source fact for "${q}" (FDA / PubMed / plasticsurgery.org — Healthline/WebMD are disallowed)`,
      'REQUIRED (human/data): one first-hand local proof point (named credentialed provider, real session protocol, or before/after policy)',
    ],
    primarySources: [],
    primarySourcesNeeded: 2,
    schemaTypes: (tmpl.schemaTypes || []).filter((t) => !DEPRECATED_RICH.has(t)),
    hasOwnMedia: false,
    fanout: { subqueryType: gap.type || 'captured', source: gap.source || fanoutSource, parentQuery },
    antiSlop: 'Routed through the existing content draft/score path: contentDraft REFUSES until dataPoints>=3 + named author + >=2 primarySources; the draft must then pass scoreContent hard gates (no free-floating generation).',
  };
}

/**
 * The planner core (pure). For each target query: enumerate the fan-out (captured or
 * synthetic, labeled), score every page against every sub-query (term-overlap cells +
 * RRF k=60 fusion across the per-sub-query rankings via rrf.predictCitation), and turn
 * sub-queries covered by NO page into gated brief stubs.
 *
 * FAIL-CLOSED: no target queries → status 'no-queries'; no scoreable pages → status
 * 'no-pages'. Neither produces stubs or a matrix — an empty input is never reported as
 * "fully covered" or turned into a fabricated work order.
 *
 * @param {object} cfg client config
 * @param {{targetQueries?:string[], pages?:Array<{url,title?,headings?,text?}>, captured?:object|Array}} input
 * @returns {{status, note?, threshold, evidence?, queries:[], stubs:[], stubsDropped?}}
 */
export function planCoverage(cfg = {}, { targetQueries = [], pages = [], captured = null } = {}) {
  const queriesIn = (Array.isArray(targetQueries) ? targetQueries : []).map((q) => String(q || '').trim()).filter(Boolean);
  if (!queriesIn.length) {
    return { status: 'no-queries', note: 'fail-closed: no target queries (set cfg.promptPanel or cfg.tracking.keywords) — nothing planned', threshold: COVERAGE_THRESHOLD, queries: [], stubs: [] };
  }
  const docs = (Array.isArray(pages) ? pages : []).filter((p) => p && p.url && docText(p));
  if (!docs.length) {
    return { status: 'no-pages', note: 'fail-closed: no scoreable pages (empty crawl / unparseable HTML) — empty coverage is NOT reported as covered', threshold: COVERAGE_THRESHOLD, queries: [], stubs: [] };
  }

  const queries = [];
  let stubs = [];
  for (const q of queriesIn) {
    const enumd = enumerateSubqueries(q, { cfg, captured });
    // RRF k=60 fusion across the per-sub-query page rankings (reuses rrf.mjs; the
    // constant is predictCitation's default — never redefined here).
    const passages = docs.map((d) => ({ id: d.url, owner: 'us', text: docText(d) }));
    const rrf = predictCitation(passages, enumd.subqueries.map((s) => ({ type: s.type, query: s.query })));

    const pageRows = docs.map((d) => {
      const main = scoreCell(q, d);
      const cells = enumd.subqueries.map((sq) => {
        const s = scoreCell(sq.query, d);
        return { subquery: sq.query, type: sq.type, source: sq.source, score: s.termCoverage, sim: s.sim, covered: isCovered(s.termCoverage) };
      });
      const coveredCount = cells.filter((c) => c.covered).length;
      return {
        url: d.url,
        mainScore: main.termCoverage,
        mainCovered: isCovered(main.termCoverage),
        cells,
        coveredCount,
        coveragePct: cells.length ? Math.round((coveredCount / cells.length) * 100) : 0,
      };
    });

    const best = rrf.fused[0] || null;
    const bestRow = best ? pageRows.find((p) => p.url === best.id) : null;
    // The EVIDENCE condition: the fused-best page answers the main query AND >=1 sub-query.
    const citationReady = !!(bestRow && bestRow.mainCovered && bestRow.coveredCount >= 1);
    const gaps = enumd.subqueries.filter((sq) => !pageRows.some((p) => p.cells.find((c) => c.subquery === sq.query)?.covered));
    for (const g of gaps) stubs.push(briefStub(g, { cfg, parentQuery: q, fanoutSource: enumd.fanoutSource }));

    queries.push({
      query: q,
      fanoutSource: enumd.fanoutSource,
      ...(enumd.note ? { note: enumd.note } : {}),
      subqueries: enumd.subqueries,
      pages: pageRows,
      rrf: { k: rrf.k, fused: rrf.fused.map((f) => ({ id: f.id, score: f.score })) },
      bestPage: best ? best.id : null,
      citationReady,
      gaps: gaps.map((g) => g.query),
    });
  }

  // Dedup stubs across target queries (two heads can share a gap sub-query) …
  const seen = new Set();
  stubs = stubs.filter((s) => !seen.has(s.slug) && seen.add(s.slug));
  // … and reuse the June-2026 scaled-content guard: never mass-produce a briefs network.
  const capped = capProgrammatic(stubs, cfg.content?.maxProgrammaticPages ?? 200);

  return {
    status: 'ok',
    generatedAt: nowIso(),
    client: cfg.name || '',
    threshold: COVERAGE_THRESHOLD,
    evidence: EVIDENCE,
    queries,
    stubs: capped.plan,
    stubsDropped: capped.dropped,
  };
}

/** Parse one fetched page into a scoreable doc (title + headings + body text, no JS). */
export function docFromHtml(pg = {}) {
  const $ = cheerio.load(pg.html || '');
  $('script,style,noscript,svg,template').remove();
  const title = ($('title').first().text() || '').trim();
  const headings = $('h1,h2,h3,h4').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return { url: pg.finalUrl || pg.url, title, headings, text };
}

/** Render the human report (pure). */
export function renderFanoutReport(plan, cfg = {}) {
  const L = [`# Fan-out coverage — ${cfg.brand || plan.client || ''}`,
    `${plan.generatedAt || ''} · threshold ${plan.threshold} (fraction of sub-query terms on page) · ${plan.queries.length} target quer${plan.queries.length === 1 ? 'y' : 'ies'}`,
    '',
    `> **Why coverage beats peak rank:** ${EVIDENCE.claim}`,
    `> Source: ${EVIDENCE.source} · evidence tier: **${EVIDENCE.tier}** · ${EVIDENCE.pointer}`,
    ''];
  for (const q of plan.queries) {
    L.push(`## "${q.query}"  \`fan-out: ${q.fanoutSource}\``);
    if (q.note) L.push(`> ⚠ ${q.note}`);
    L.push(`RRF fused best page (k=${q.rrf.k}): ${q.bestPage ? `\`${q.bestPage}\`` : '—'} · citation-ready (main + ≥1 sub-query): ${q.citationReady ? '✅' : '⛔'}`);
    L.push('', '| Sub-query | src | best page | score | covered |', '|---|---|---|---|---|');
    for (const sq of q.subqueries) {
      let best = null;
      for (const p of q.pages) {
        const c = p.cells.find((x) => x.subquery === sq.query);
        if (c && (!best || c.score > best.score)) best = { url: p.url, score: c.score, covered: c.covered };
      }
      L.push(`| ${sq.query} | ${sq.source} | ${best ? best.url : '—'} | ${best ? best.score : 0} | ${best?.covered ? '✅' : '⛔ gap'} |`);
    }
    if (q.gaps.length) L.push('', `**Gaps (${q.gaps.length}):** ${q.gaps.map((g) => `"${g}"`).join(' · ')}`);
    L.push('');
  }
  if (plan.stubs.length) {
    L.push(`## Brief stubs (${plan.stubs.length}${plan.stubsDropped ? ` · ${plan.stubsDropped} dropped by the scaled-content cap` : ''})`);
    L.push('', 'Each stub lands in `drafts/<slug>.brief.json`. Drafting is REFUSED until a human fills ≥3 real dataPoints, a named author, and ≥2 primary sources — then `content draft` → `content score` → human approve.', '');
    for (const s of plan.stubs) L.push(`- [ ] \`${s.slug}\` — "${s.targetQuery}" (${s.template}, from ${s.fanout.source} fan-out of "${s.parentQuery}")`);
  } else {
    L.push('## Brief stubs', '', '_No gaps — every sub-query is covered by at least one page._');
  }
  return L.join('\n');
}

/** Persist reports/<client>/fanout-coverage.{md,json}. */
export function saveFanoutReport(cfg, plan) {
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const mdPath = join(dir, 'fanout-coverage.md');
  const jsonPath = join(dir, 'fanout-coverage.json');
  writeFileSync(mdPath, renderFanoutReport(plan, cfg));
  writeFileSync(jsonPath, JSON.stringify(plan, null, 2));
  return { mdPath, jsonPath };
}

/**
 * Write stubs into the EXISTING drafts path (reports/<client>/drafts/<slug>.brief.json)
 * so `content draft/score/approve` picks them up. NEVER clobbers an existing brief — a
 * human may already have filled its data points.
 */
export function writeBriefStubs(cfg, stubs = []) {
  const dir = join(ROOT, 'reports', cfg.name, 'drafts');
  mkdirSync(dir, { recursive: true });
  let written = 0, skipped = 0;
  for (const s of stubs) {
    const p = join(dir, `${s.slug}.brief.json`);
    if (existsSync(p)) { skipped++; continue; }
    writeFileSync(p, JSON.stringify(s, null, 2));
    written++;
  }
  return { dir, written, skipped };
}

function readCaptured(cfg) {
  const p = join(ROOT, 'reports', cfg.name, 'fanout-capture.json');
  if (!existsSync(p)) return { captured: null, note: 'no fanout-capture.json — synthesizing (labeled synthetic)' };
  try { return { captured: JSON.parse(readFileSync(p, 'utf-8')), note: null }; }
  catch { return { captured: null, note: 'fanout-capture.json unparseable — IGNORED (fail-closed), synthesizing instead' }; }
}

/** CLI shell: crawl → plan → report → stubs.  `fanout-plan <client> [--max N] [--no-stubs]` */
export async function runFanoutPlan(cfg, { log = () => {}, maxPages = 0, writeStubs = true } = {}) {
  const targetQueries = (cfg.promptPanel?.length ? cfg.promptPanel : cfg.tracking?.keywords || []).slice(0, 12);
  if (!targetQueries.length) {
    log('  ⛔ no target queries — set cfg.promptPanel (run `discover <client> --write`) or cfg.tracking.keywords.');
    return { status: 'no-queries', note: 'no target queries configured', queries: [], stubs: [] };
  }
  const { captured, note: capNote } = readCaptured(cfg);
  if (capNote) log(`  (${capNote})`);

  const { discoverUrls, fetchPages } = await import('./crawl.mjs');
  log(`  Discovering + fetching pages (raw HTML — what AI crawlers see) …`);
  const { urls } = await discoverUrls(cfg);
  const take = urls.slice(0, Math.max(1, maxPages || Math.min(cfg.audit?.maxPages || 25, 25)));
  const fetched = await fetchPages(take, cfg);
  const docs = fetched.filter((p) => p.ok && p.status === 200).map((p) => docFromHtml(p));

  const plan = planCoverage(cfg, { targetQueries, pages: docs, captured });
  if (plan.status !== 'ok') { log(`  ⛔ ${plan.status}: ${plan.note}`); return plan; }

  const { mdPath, jsonPath } = saveFanoutReport(cfg, plan);
  const capturedN = plan.queries.filter((q) => q.fanoutSource === 'captured').length;
  const ready = plan.queries.filter((q) => q.citationReady).length;
  log(`  Fan-out coverage: ${plan.queries.length} queries (${capturedN} captured, ${plan.queries.length - capturedN} synthetic) × ${docs.length} pages · threshold ${plan.threshold}`);
  log(`  Citation-ready (main + ≥1 sub-query, the +161% condition): ${ready}/${plan.queries.length}`);
  log(`  Gaps → ${plan.stubs.length} brief stub(s)${plan.stubsDropped ? ` (${plan.stubsDropped} dropped by the scaled-content cap)` : ''}`);
  if (writeStubs && plan.stubs.length) {
    const w = writeBriefStubs(cfg, plan.stubs);
    log(`  Stubs → ${w.dir} (${w.written} written, ${w.skipped} already existed — not clobbered)`);
    log(`  Next (human): fill dataPointsNeeded → \`content draft ${cfg.name} "<targetQuery>"\` → \`content score\` → approve. Nothing drafts or publishes on its own.`);
  }
  log(`  Report → ${mdPath}`);
  return { ...plan, mdPath, jsonPath };
}
