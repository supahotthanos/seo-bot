// seo-bot · techaudit — the technical-SEO crawl the sitemap-sampler couldn't do.
// A real BFS link-crawl from the homepage that records: click-DEPTH per URL, full
// REDIRECT CHAINS (manual hop-by-hop, not collapsed), X-Robots-Tag + meta-robots
// directives (the silent de-index + snippet gates AI Overviews care about), canonical
// targets, and the internal edge graph. Then it RECONCILES the crawl against the sitemap
// to find true orphans, and builds a per-URL INDEXABILITY MATRIX flagging contradictions
// (noindex page in sitemap, canonical→non-200, money page buried 4+ clicks deep, multi-hop
// redirect, loop). Closes the #1 finding from the 50-agent gap hunt.

import * as cheerio from 'cheerio';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { fetchWithChain, parseRobotsDirectives, absUrl, sameSite, sleep, nowIso } from './util.mjs';
import { discoverUrls } from './crawl.mjs';

const norm = (u) => (u || '').split('#')[0].replace(/\/$/, '');
const MONEY_RE = /\/(treatment|service|services|treatments|med-spa|botox|filler|cost|best|locations?|[a-z-]+-[a-z]{2})\b/i;

export async function techAudit(cfg, { log = () => {}, maxPages = 150 } = {}) {
  const start = norm(cfg.baseUrl);
  log(`Tech-audit BFS crawl from ${cfg.baseUrl} (≤${maxPages} pages, following links) …`);
  const queue = [{ url: cfg.baseUrl, depth: 0 }];
  const visited = new Map();
  const edges = new Map();
  const politeness = cfg.audit?.politenessMs || 300;

  while (queue.length && visited.size < maxPages) {
    const { url, depth } = queue.shift();
    const key = norm(url);
    if (visited.has(key)) continue;
    const r = await fetchWithChain(url, { wantBody: true });
    const $ = cheerio.load(r.text || '');
    const metaRobots = parseRobotsDirectives($('meta[name="robots"]').attr('content') || $('meta[name="googlebot"]').attr('content') || '');
    const xRobots = parseRobotsDirectives(r.headers?.get?.('x-robots-tag') || '');
    const canHref = $('link[rel="canonical"]').attr('href');
    const canonical = canHref ? norm(absUrl(r.finalUrl, canHref) || canHref) : null;
    visited.set(key, { url: key, finalUrl: norm(r.finalUrl), depth, status: r.status, hops: Math.max(0, r.chain.length - 1), chain: r.chain, loop: !!r.loop, metaRobots, xRobots, canonical, money: MONEY_RE.test(key) });

    if (r.status >= 200 && r.status < 300) {
      const outs = new Set();
      $('a[href]').each((_, el) => {
        const abs = absUrl(r.finalUrl, $(el).attr('href'));
        if (!abs || !sameSite(abs, cfg.baseUrl)) return;
        const t = norm(abs);
        if (!t.startsWith('http')) return;
        outs.add(t);
        if (!visited.has(t) && !queue.some((q) => norm(q.url) === t)) queue.push({ url: t, depth: depth + 1 });
      });
      edges.set(key, outs);
    }
    await sleep(politeness);
  }
  const crawlComplete = queue.length === 0; // queue emptied → we saw every reachable page

  // inlink counts
  const inlinks = new Map();
  for (const outs of edges.values()) for (const t of outs) inlinks.set(t, (inlinks.get(t) || 0) + 1);

  // sitemap reconciliation (pull the full sitemap set, not the sample)
  const savedMax = cfg.audit.maxPages;
  cfg.audit.maxPages = 5000;
  let sitemapSet = new Set();
  try { const d = await discoverUrls(cfg); sitemapSet = new Set(d.urls.map(norm)); } catch { /* best effort */ } finally { cfg.audit.maxPages = savedMax; }

  const crawled = new Set([...visited.keys()]);
  const live2xx = new Set([...visited.values()].filter((r) => r.status >= 200 && r.status < 300).map((r) => r.url));
  // Orphan reconciliation is only sound when the crawl reached every linked page; on a
  // capped crawl the "unreached" set is just the uncrawled remainder, not real orphans.
  const sitemapOrphans = crawlComplete ? [...sitemapSet].filter((u) => !crawled.has(u)) : [];
  const notInSitemap = crawlComplete ? [...live2xx].filter((u) => u !== start && !sitemapSet.has(u)) : [];
  if (!crawlComplete) log(`  ⚠️  crawl capped at ${maxPages} (site has more) → orphan reconciliation skipped; raise --max to a number above the page count for that.`);

  // issues
  const redirectChains = [...visited.values()].filter((r) => r.hops >= 2 || r.loop).map((r) => ({ url: r.url, hops: r.hops, loop: r.loop, chain: r.chain.map((c) => `${c.status}→${c.location || ''}`) }));
  const deepPages = [...visited.values()].filter((r) => r.depth >= 4 && r.status >= 200 && r.status < 300).map((r) => ({ url: r.url, depth: r.depth, money: r.money }));
  const noindexInSitemap = [...visited.values()].filter((r) => (r.metaRobots.noindex || r.xRobots.noindex) && sitemapSet.has(r.url)).map((r) => r.url);
  const snippetCapped = [...visited.values()].filter((r) => r.metaRobots.nosnippet || r.xRobots.nosnippet || r.metaRobots.maxSnippet === '0').map((r) => r.url);
  const badCanonical = [...visited.values()].filter((r) => r.canonical && r.canonical !== r.url && !live2xx.has(r.canonical)).map((r) => ({ url: r.url, canonical: r.canonical }));
  const broken = [...visited.values()].filter((r) => r.status >= 400 || r.status === 0).map((r) => ({ url: r.url, status: r.status }));

  const L = [`# Technical-SEO audit — ${cfg.brand}`, `${visited.size} pages BFS-crawled${crawlComplete ? ' (complete)' : ` (capped at ${maxPages} — orphan checks skipped)`} · ${sitemapSet.size} in sitemap · ${nowIso()}`, ''];
  const sec = (title, arr, fmt) => { L.push(`## ${title} (${arr.length})`); if (!arr.length) L.push('- none ✅'); else arr.slice(0, 25).forEach((x) => L.push('- ' + fmt(x))); L.push(''); };
  sec('🔴 Broken pages (4xx/5xx/timeout)', broken, (x) => `${x.url} → ${x.status}`);
  sec('🔴 Noindex pages still in sitemap (silent de-index)', noindexInSitemap, (u) => u);
  sec('🟠 Redirect chains / loops (>1 hop bleeds equity)', redirectChains, (x) => `${x.url} [${x.hops} hops${x.loop ? ', LOOP' : ''}] ${x.chain.join(' ')}`);
  sec('🟠 Canonical → non-200 / uncrawlable target', badCanonical, (x) => `${x.url} → canonical ${x.canonical}`);
  sec('🟠 Money pages buried ≥4 clicks deep', deepPages.filter((d) => d.money), (x) => `${x.url} (depth ${x.depth})`);
  sec('🟡 Sitemap orphans (in sitemap, unreachable by links)', sitemapOrphans, (u) => u);
  sec('🟡 Crawlable but missing from sitemap', notInSitemap, (u) => u);
  sec('🟡 Snippet-capped (nosnippet/max-snippet:0 — blocks AI citation)', snippetCapped, (u) => u);

  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'techaudit.md'), L.join('\n'));
  const matrix = [...visited.values()].map((r) => ({ url: r.url, depth: r.depth, status: r.status, hops: r.hops, inlinks: inlinks.get(r.url) || 0, inSitemap: sitemapSet.has(r.url), noindex: r.metaRobots.noindex || r.xRobots.noindex, canonical: r.canonical, money: r.money }));
  writeFileSync(join(dir, 'techaudit.json'), JSON.stringify({ client: cfg.name, ranAt: nowIso(), crawled: visited.size, crawlComplete, inSitemap: sitemapSet.size, issues: { broken: broken.length, noindexInSitemap: noindexInSitemap.length, redirectChains: redirectChains.length, badCanonical: badCanonical.length, deepMoneyPages: deepPages.filter((d) => d.money).length, sitemapOrphans: sitemapOrphans.length, notInSitemap: notInSitemap.length, snippetCapped: snippetCapped.length }, matrix }, null, 2));

  const totalIssues = broken.length + noindexInSitemap.length + redirectChains.length + badCanonical.length + deepPages.filter((d) => d.money).length + sitemapOrphans.length + snippetCapped.length;
  log(`\n  Tech-audit: ${visited.size} crawled · ${totalIssues} issues`);
  log(`  🔴 ${broken.length} broken · ${noindexInSitemap.length} noindex-in-sitemap · 🟠 ${redirectChains.length} redirect-chains · ${badCanonical.length} bad-canonical · ${deepPages.filter((d) => d.money).length} deep-money · 🟡 ${sitemapOrphans.length} sitemap-orphans`);
  log(`  → ${join(dir, 'techaudit.md')}\n`);
  return { crawled: visited.size, broken, noindexInSitemap, redirectChains, badCanonical, deepPages, sitemapOrphans, notInSitemap, snippetCapped, matrix };
}
