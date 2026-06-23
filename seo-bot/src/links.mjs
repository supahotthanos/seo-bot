// seo-bot · links — internal-link PageRank (offline, free, no API). Crawls the site,
// builds the internal-link graph, runs PageRank (power iteration), and surfaces
// "money pages" (service/treatment/location) that are equity-starved + orphan pages,
// with concrete "add an internal link from <high-PR page>" suggestions. Per Cyrus
// Shepard / Zyppy: internal links + anchor variety are an underused on-site lever.

import * as cheerio from 'cheerio';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { discoverUrls, fetchPages } from './crawl.mjs';
import { absUrl, sameSite, nowIso } from './util.mjs';

const norm = (u) => (u || '').split('#')[0].replace(/\/$/, '');
const MONEY_RE = /\/(treatment|service|services|treatments|med-spa|cost|best|locations?|[a-z-]+-[a-z]{2})\b/i;

function pagerank(graph, { alpha = 0.85, iters = 50 } = {}) {
  const nodes = [...graph.keys()];
  const N = nodes.length || 1;
  const outdeg = new Map(nodes.map((n) => [n, graph.get(n).size]));
  const inlinks = new Map(nodes.map((n) => [n, []]));
  for (const [src, tgts] of graph) for (const t of tgts) if (inlinks.has(t)) inlinks.get(t).push(src);
  let pr = new Map(nodes.map((n) => [n, 1 / N]));
  for (let it = 0; it < iters; it++) {
    let dangling = 0;
    for (const n of nodes) if (outdeg.get(n) === 0) dangling += pr.get(n);
    const next = new Map();
    for (const n of nodes) {
      let sum = 0;
      for (const src of inlinks.get(n)) sum += pr.get(src) / (outdeg.get(src) || 1);
      next.set(n, (1 - alpha) / N + alpha * (sum + dangling / N));
    }
    pr = next;
  }
  return { pr, inlinks, outdeg };
}

export async function analyzeLinks(cfg, { log = () => {} } = {}) {
  log(`Crawling ${cfg.domain} for the internal-link graph …`);
  const { urls } = await discoverUrls(cfg);
  const pages = await fetchPages(urls, cfg);
  const inSet = new Set(pages.filter((p) => p.ok).map((p) => norm(p.finalUrl || p.url)));

  const graph = new Map([...inSet].map((u) => [u, new Set()]));
  for (const pg of pages) {
    if (!pg.ok) continue;
    const from = norm(pg.finalUrl || pg.url);
    const $ = cheerio.load(pg.html || '');
    $('a[href]').each((_, el) => {
      const abs = absUrl(pg.finalUrl || pg.url, $(el).attr('href'));
      if (!abs || !sameSite(abs, cfg.baseUrl)) return;
      const t = norm(abs);
      if (t !== from && inSet.has(t)) graph.get(from).add(t);
    });
  }

  const { pr, inlinks, outdeg } = pagerank(graph);
  const ranked = [...pr.entries()].map(([url, score]) => ({ url, score, inlinks: inlinks.get(url).length, outlinks: outdeg.get(url), money: MONEY_RE.test(url) })).sort((a, b) => b.score - a.score);
  const median = ranked.length ? ranked[Math.floor(ranked.length / 2)].score : 0;
  const orphans = ranked.filter((r) => r.inlinks === 0);
  // Money pages with below-median PageRank = equity-starved → boost with inlinks from top pages.
  const starved = ranked.filter((r) => r.money && r.score < median).sort((a, b) => a.score - b.score).slice(0, 20);
  const hubs = ranked.slice(0, 5).map((r) => r.url);

  const L = [`# Internal-link PageRank — ${cfg.brand}`, `${ranked.length} pages crawled · ${new Date().toUTCString()}`, ''];
  L.push('## Top pages by internal PageRank');
  ranked.slice(0, 10).forEach((r, i) => L.push(`${i + 1}. ${r.url}  (PR ${(r.score * 1000).toFixed(2)}‰, ${r.inlinks} inlinks)`));
  if (orphans.length) { L.push('', `## Orphan pages (0 internal inlinks) — ${orphans.length}`); orphans.slice(0, 20).forEach((r) => L.push(`- ${r.url} → add a link from a relevant page`)); }
  L.push('', '## Equity-starved money pages (boost these)');
  if (!starved.length) L.push('- none (money pages are well-linked).');
  for (const r of starved) L.push(`- [ ] **${r.url}** (PR ${(r.score * 1000).toFixed(2)}‰, ${r.inlinks} inlinks) — add varied-anchor links from a top hub (e.g. ${hubs[0]})`);
  L.push('', `_Hubs (highest PR, good link sources): ${hubs.join(', ')}_`);

  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'links.md'), L.join('\n'));
  writeFileSync(join(dir, 'links.json'), JSON.stringify({ client: cfg.name, ranAt: nowIso(), pages: ranked.length, orphans: orphans.length, starved, hubs, top: ranked.slice(0, 20) }, null, 2));

  log(`\n  PageRank: ${ranked.length} pages · ${orphans.length} orphans · ${starved.length} equity-starved money pages`);
  log(`  Top hub: ${hubs[0]}`);
  if (starved.length) log(`  Boost first: ${starved[0].url}`);
  log(`  → ${join(dir, 'links.md')}\n`);
  return { ranked, orphans, starved, hubs };
}
