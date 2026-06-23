// seo-bot · sculpt — internal-link budget optimizer (greedy, server-rendered apply-plan).
//
// Ties Epic 10 together: weighted reasonable-surfer PageRank (pagerank-weighted.mjs) tells
// us where equity sits; the semantic mesh (mesh.mjs) tells us which links are TOPICALLY
// justified; the anchor selector (anchors.mjs) gives anti-slop, entropy-bounded anchor text.
// This greedy optimizer chooses a small set of NEW links to:
//   1. push below-median MONEY pages above median weighted-PR (equity to revenue pages),
//   2. reduce click-depth toward ≤3 (deep pages get a link from a shallow hub),
//   3. give every ORPHAN (sitemap ∪ GSC ∪ logs − crawl-linked) ≥1 contextual inlink,
//   while keeping every page within a 5–44 in-body-link budget (hard cap ~44 — beyond that
//   each link's equity share is negligible and the page reads as a link farm).
//
// Output is a SERVER-RENDERED apply-plan: each item is {sourceUrl,targetUrl,anchor,
// paragraphOffset} PLUS a `patch` payload ({file,find,replace}) shaped for apply/nextjs.mjs's
// EXISTING find/replace PR path — we insert a real <a> into a real existing sentence (never
// client JS, never a fabricated paragraph). It also registers a diff-in-diff experiment via
// stats/controller.mjs (returned as a hook the orchestrator/stats layer runs at the horizon).

import * as cheerio from 'cheerio';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { discoverUrls, fetchPages } from './crawl.mjs';
import { absUrl, sameSite, nowIso } from './util.mjs';
import { buildWeightedGraph, weightedPageRank } from './pagerank-weighted.mjs';
import { candidateLinks } from './mesh.mjs';
import { pickAnchor } from './anchors.mjs';

const norm = (u) => (u || '').split('#')[0].replace(/\/$/, '');
const MONEY_RE = /\/(treatment|service|services|treatments|med-spa|cost|best|locations?|[a-z-]+-[a-z]{2})\b/i;
const LINK_BUDGET = { min: 5, max: 44 };

/** Extract the data mesh.mjs needs from a fetched page: visible text, paragraphs, existing targets, H1/title. */
function pageDoc(pg, cfg) {
  const $ = cheerio.load(pg.html || '');
  $('script,style,noscript,svg,template').remove();
  const url = norm(pg.finalUrl || pg.url);
  const paragraphs = $('p').toArray().map((el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    return { text, html: $.html(el), words: text.split(/\s+/).filter(Boolean).length };
  }).filter((p) => p.words >= 6);
  const existingTargets = new Set();
  cheerio.load(pg.html || '')('a[href]').each((_, el) => {
    const abs = absUrl(pg.finalUrl || pg.url, cheerio.load(pg.html)(el).attr('href'));
    if (abs && sameSite(abs, cfg.baseUrl)) existingTargets.add(norm(abs));
  });
  const text = paragraphs.map((p) => p.text).join('\n');
  const title = (cheerio.load(pg.html || '')('title').first().text() || '').trim();
  const h1 = (cheerio.load(pg.html || '')('h1').first().text() || '').trim();
  return { url, text, paragraphs, existingTargets, title, h1, inBodyLinkCount: countInBodyLinks(pg, cfg) };
}

/** Count in-body (non-nav/footer) internal links — the figure the 5–44 budget governs. */
function countInBodyLinks(pg, cfg) {
  const $ = cheerio.load(pg.html || '');
  let n = 0;
  $('a[href]').each((_, el) => {
    const abs = absUrl(pg.finalUrl || pg.url, $(el).attr('href'));
    if (!abs || !sameSite(abs, cfg.baseUrl)) return;
    // crude in-body test: not inside nav/header/footer/aside
    if ($(el).closest('nav,header,footer,aside').length) return;
    n++;
  });
  return n;
}

/** BFS click-depth from the homepage over the (unweighted) reachability graph. */
function clickDepths(graph, home) {
  const depth = new Map([[home, 0]]);
  const q = [home];
  while (q.length) {
    const u = q.shift();
    for (const v of (graph.get(u)?.keys?.() || [])) {
      if (!depth.has(v)) { depth.set(v, depth.get(u) + 1); q.push(v); }
    }
  }
  return depth;
}

/**
 * Build a server-rendered apply-plan item: insert an <a> into a real existing paragraph.
 * Produces a `patch` payload ({file,find,replace}) compatible with apply/nextjs.mjs as-is —
 * find = the exact source sentence (or paragraph text), replace = same text with the first
 * unlinked occurrence of the anchor phrase wrapped in <a href>. If the anchor phrase isn't
 * present verbatim we DON'T fabricate prose; we mark the item advisory (autoApplicable:false)
 * so a human places it. `file` is left for the dev team to resolve (templated routes) unless
 * cfg.sculpt.fileFor maps a URL→source file.
 */
function buildApplyItem(srcDoc, item, cfg) {
  const anchor = item.anchor;
  const href = item.targetUrl;
  // Find a paragraph whose text contains the anchor phrase (case-insensitive), nearest the offset.
  let cursor = 0, chosen = null;
  for (const p of srcDoc.paragraphs) {
    const idx = p.text.toLowerCase().indexOf(anchor.toLowerCase());
    if (idx >= 0 && !/<a\b/i.test(p.html.slice(0, idx))) { chosen = { p, idx }; break; }
    cursor += p.words;
  }
  const base = { sourceUrl: srcDoc.url, targetUrl: href, anchor, paragraphOffset: item.paragraphOffset, score: item.score, reason: item.reason };
  if (!chosen) {
    // Anchor phrase not present verbatim — never invent a sentence; emit an advisory placement.
    return { ...base, autoApplicable: false, advisory: `place a contextual link to ${href} using anchor "${anchor}" in a relevant paragraph` };
  }
  // Replace the FIRST verbatim, currently-unlinked occurrence in the source sentence.
  const re = new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const find = chosen.p.text;
  const replace = find.replace(re, (m) => `<a href="${href}">${m}</a>`);
  const fileFor = cfg.sculpt?.fileFor || {};
  const file = fileFor[srcDoc.url] || null;
  return {
    ...base,
    autoApplicable: !!file,
    // patch payload understood by apply/nextjs.mjs (it requires a unique find within `file`).
    patch: file ? { file, find, replace } : undefined,
    advisory: file ? undefined : `insert into source for ${srcDoc.url}: replace «${find.slice(0, 80)}…» wrapping "${anchor}" → ${href}`,
  };
}

/**
 * The greedy sculptor. Pure-ish: does I/O only to write the plan artifact.
 * @param {Array} pages   fetched pages (ok flag + html). If omitted, sculptLinks crawls.
 * @param {{pr:Map}} pr   weighted-PageRank result (pr map). If omitted, computed here.
 * @param {{cfg:object, gscUrls?:string[], logUrls?:string[], sitemapUrls?:string[], log?:Function}} options
 * @returns {Promise<{plan:Array, starved:Array, orphans:Array, depthFixes:Array, experiment:object, write:Function}>}
 */
export async function sculptLinks(pages, pr, { cfg, gscUrls = [], logUrls = [], sitemapUrls = [], log = () => {} } = {}) {
  if (!pages) {
    const { urls } = await discoverUrls(cfg);
    pages = await fetchPages(urls, cfg);
    sitemapUrls = urls.map(norm);
  }
  const ok = pages.filter((p) => p.ok);
  const docs = ok.map((p) => pageDoc(p, cfg));
  const byUrl = new Map(docs.map((d) => [d.url, d]));

  // 1) Weighted graph + PageRank (reuse caller's pr if provided).
  const { graph, inSet } = buildWeightedGraph(pages, cfg, { cheerio, absUrl, sameSite });
  const prMap = pr?.pr || weightedPageRank(graph).pr;
  const ranked = [...prMap.entries()].map(([url, score]) => ({ url, score, money: MONEY_RE.test(url), inBody: byUrl.get(url)?.inBodyLinkCount ?? 0 })).sort((a, b) => b.score - a.score);
  const median = ranked.length ? ranked[Math.floor(ranked.length / 2)].score : 0;
  const hubs = ranked.filter((r) => r.inBody < LINK_BUDGET.max).slice(0, 8).map((r) => r.url);
  const home = norm(cfg.baseUrl);

  // 2) Targets: below-median money pages, orphans (any source minus crawl-linked), deep pages.
  const linkedTargets = new Set();
  for (const m of graph.values()) for (const t of m.keys()) linkedTargets.add(t);
  const known = new Set([...inSet, ...gscUrls.map(norm), ...logUrls.map(norm), ...sitemapUrls.map(norm)]);
  const orphans = [...known].filter((u) => sameSite(u, cfg.baseUrl) && !linkedTargets.has(u) && u !== home);
  const starved = ranked.filter((r) => r.money && r.score < median).map((r) => r.url);
  const depth = clickDepths(graph, home);
  const deep = ranked.filter((r) => (depth.get(r.url) ?? 99) > 3).map((r) => r.url);

  // 3) Mesh candidates (semantic) for choosing WHICH source links to which target contextually.
  const meshDocs = docs.map((d) => ({ url: d.url, text: d.text, paragraphs: d.paragraphs, existingTargets: d.existingTargets }));
  const candidates = await candidateLinks(meshDocs, { cfg, topK: 6, log });
  const candByTarget = new Map();
  for (const c of candidates) { if (!candByTarget.has(c.tgt)) candByTarget.set(c.tgt, []); candByTarget.get(c.tgt).push(c); }

  // Per-source in-body budget tracker (start from current count; never exceed the cap).
  const budget = new Map(docs.map((d) => [d.url, d.inBodyLinkCount]));
  const usedAnchors = new Map(); // running site-wide anchor tally → entropy lever in pickAnchor

  /** Pick the best contextual SOURCE for a target, respecting budget; fall back to a hub. */
  const placeLink = async (targetUrl, reason) => {
    const cands = (candByTarget.get(targetUrl) || []).filter((c) => (budget.get(c.src) ?? 99) < LINK_BUDGET.max).sort((a, b) => b.score - a.score);
    let pick = cands[0];
    if (!pick) {
      // No semantic source under budget — use the highest-PR hub that has room and isn't the target.
      const hub = hubs.find((h) => h !== targetUrl && (budget.get(h) ?? 99) < LINK_BUDGET.max);
      if (!hub) return null;
      pick = { src: hub, tgt: targetUrl, score: 0.3, paragraphOffset: 0 };
    }
    const srcDoc = byUrl.get(pick.src);
    const tgtDoc = byUrl.get(targetUrl);
    const a = await pickAnchor({ src: pick.src, tgt: targetUrl, score: pick.score, target: { title: tgtDoc?.title, h1: tgtDoc?.h1 } }, { usedAnchors, cfg });
    if (!a.anchor) return null;
    budget.set(pick.src, (budget.get(pick.src) || 0) + 1);
    const item = buildApplyItem(srcDoc, { anchor: a.anchor, targetUrl, paragraphOffset: pick.paragraphOffset, score: Math.round((pick.score) * (a.score || 1) * 1000) / 1000, reason }, cfg);
    return { ...item, anchorVariants: a.variants, diversityBonus: a.diversityBonus, needsHumanReview: a.needsHumanReview };
  };

  // 4) Greedy: orphans first (indexation), then starved money pages (revenue), then depth (≤3).
  const plan = [];
  const depthFixes = [];
  for (const u of orphans) { const it = await placeLink(u, 'orphan-rescue (no internal inlinks)'); if (it) plan.push(it); }
  for (const u of starved) { const it = await placeLink(u, 'equity-starved money page (below median weighted-PR)'); if (it) plan.push(it); }
  for (const u of deep.slice(0, 25)) { const it = await placeLink(u, `click-depth ${depth.get(u)} > 3 — link from a shallow hub`); if (it) { plan.push(it); depthFixes.push(it); } }

  // 5) Experiment hook: register this batch as a diff-in-diff experiment so the stats
  //    controller can judge the link-equity change vs matched controls at a locked horizon.
  const experiment = makeLinkExperiment(cfg, plan, { ranked, median });

  const write = () => writePlan(cfg, { plan, starved, orphans, deep, hubs, median, ranked });
  log(`  sculpt: ${plan.length} link placements (${orphans.length} orphans, ${starved.length} starved money pages, ${depthFixes.length} depth fixes); budget cap ${LINK_BUDGET.max}/page`);
  return { plan, starved, orphans, depthFixes, hubs, ranked, median, experiment, write };
}

/**
 * Build the diff-in-diff experiment record for stats/controller.mjs.
 * Returns a HOOK (not a side effect): { register(beforeAfter), changeStub } so the orchestrator
 * /stats layer supplies the before/after GSC clicks+impressions for each touched target and a
 * matched control set, then calls runController(client, changes) at the locked horizon. The
 * controller already does two-proportion-z / DiD / BH-FDR — we only shape the change records.
 */
export function makeLinkExperiment(cfg, plan, { ranked = [], median = 0 } = {}) {
  const targets = [...new Set(plan.map((p) => p.targetUrl))];
  // Suggest matched controls: same-band PR money pages we did NOT touch this batch.
  const touched = new Set(targets);
  const controls = ranked.filter((r) => r.money && !touched.has(r.url) && r.score < median).slice(0, targets.length).map((r) => r.url);
  const lockedHorizonDate = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10); // 28-day locked horizon
  return {
    kind: 'internal-link-sculpt',
    client: cfg.name,
    targets,
    controls,
    lockedHorizonDate,
    /**
     * Turn measured GSC before/after into change records the controller evaluates.
     * @param {Map<string,{before,after}>} measuredTargets  url → {before:{clicks,impressions}, after:{...}}
     * @param {{before,after}} measuredControl  aggregated control before/after (DiD baseline)
     * @returns {Array} change records for runController(client, changes)
     */
    toChanges(measuredTargets = new Map(), measuredControl = null) {
      return targets.map((url) => {
        const m = measuredTargets.get(url) || {};
        return { id: `linksculpt:${url}`, page: url, before: m.before, after: m.after, control: measuredControl, lockedHorizonDate, days: m.days };
      }).filter((c) => c.before && c.after);
    },
  };
}

/** Persist the apply-plan + report (markdown + json). Mirrors links.mjs output location. */
export function writePlan(cfg, { plan, starved, orphans, deep, hubs, median, ranked }) {
  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const L = [`# Internal-link sculpt plan — ${cfg.brand}`, `${plan.length} link placements · ${new Date().toUTCString()}`, '',
    `Budget: ${LINK_BUDGET.min}–${LINK_BUDGET.max} in-body links/page · target depth ≤3 · server-rendered (PR via apply/nextjs.mjs), never client JS.`, '',
    '> All anchors are anti-slop + entropy-bounded and flagged needsHumanReview — review before merge.', ''];
  L.push(`## Plan (${plan.length})`);
  for (const p of plan) {
    L.push(`- [ ] **${p.sourceUrl}** → ${p.targetUrl}  · anchor: "${p.anchor}"  (${p.reason})`);
    if (p.advisory) L.push(`    - ${p.advisory}`);
    if (p.patch) L.push(`    - patch: ${p.patch.file}`);
  }
  L.push('', `## Orphans (${orphans.length})`, ...orphans.slice(0, 30).map((u) => `- ${u}`));
  L.push('', `## Equity-starved money pages (${starved.length})`, ...starved.slice(0, 30).map((u) => `- ${u}`));
  L.push('', `_Hubs: ${hubs.join(', ')}_`);
  const md = join(dir, 'link-sculpt.md');
  const json = join(dir, 'link-sculpt.json');
  writeFileSync(md, L.join('\n'));
  // The apply-plan JSON doubles as a proposals payload: items with .patch are auto-applicable.
  const proposals = plan.map((p, i) => ({ id: i + 1, type: 'internal-link', page: p.sourceUrl, severity: 'medium', autoApplicable: !!p.patch, patch: p.patch, current: '(no contextual link)', proposed: `<a href="${p.targetUrl}">${p.anchor}</a>`, rationale: p.reason, targetUrl: p.targetUrl, needsHumanReview: true }));
  writeFileSync(json, JSON.stringify({ client: cfg.name, ranAt: nowIso(), median, count: plan.length, proposals, plan }, null, 2));
  return { md, json, proposals };
}

/** CLI-ish entry: crawl → weighted PR → mesh → sculpt → write. Mirrors analyzeLinks signature. */
export async function runSculpt(cfg, { log = () => {}, gscUrls = [], logUrls = [] } = {}) {
  log(`Sculpting internal links for ${cfg.brand} …`);
  const r = await sculptLinks(null, null, { cfg, gscUrls, logUrls, log });
  const { md, json } = r.write();
  log(`\n  ${r.plan.length} placements · ${r.orphans.length} orphans · ${r.starved.length} starved money pages`);
  log(`  → ${md}\n  → ${json}`);
  return r;
}
