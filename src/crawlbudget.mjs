// seo-bot · crawlbudget — crawl-budget intelligence from our OWN access logs (OTTO
// can't do this: no server = no logs). Consumes the normalized event store
// (connect/logs.mjs) + verified-bot tagging (connect/aibot-ips.mjs verifyBot /
// analyzeCrawlLog) and computes, per URL-template:
//   • crawl ratio  — % of strategic (sitemap) URLs a VERIFIED Googlebot actually fetched
//   • crawl-waste % — bucketed by 3xx / 4xx / 5xx / param / faceted / soft-404
//   • orphan + never-crawled — set-join of (logs ∪ sitemap) vs internal-link-reachable
// and turns the waste into gated fix proposals for the existing decide/apply pipeline.
//
// Output: reports/<client>/crawlbudget.{json,md}.  No new deps.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso, hostOf, pct } from './util.mjs';
import { readEvents } from './connect/logs.mjs';
import { discoverUrls } from './crawl.mjs';
import { analyzeLinks } from './links.mjs';
import { fetchBotRanges, verifyBot } from './connect/aibot-ips.mjs';

const norm = (u) => (u || '').split('#')[0].replace(/\/$/, '');

/** Bucket a URL path into a stable template (digits→:id, long slugs→:slug). */
export function urlTemplate(path) {
  const p = (path || '/').split('?')[0];
  const segs = p.split('/').filter(Boolean).map((s) => {
    if (/^\d+$/.test(s)) return ':id';
    if (/^[0-9a-f]{8,}$/i.test(s)) return ':hash';
    if (/\d/.test(s) && /[a-z]/i.test(s) && s.length > 12) return ':slug';
    return s;
  });
  return '/' + segs.join('/');
}

/** Classify a single bot event into a waste bucket (or 'ok'). */
export function wasteBucket(ev) {
  const s = ev.status || 0;
  const path = ev.path || '';
  const qs = path.includes('?') ? path.split('?')[1] : '';
  if (s >= 500) return '5xx';
  if (s >= 400) return '4xx';
  if (s >= 300) return '3xx';
  // 2xx but likely wasteful crawl:
  const params = new URLSearchParams(qs);
  const keys = [...params.keys()];
  const FACET = /(filter|facet|sort|color|size|brand|price|category|tag|page|view|orderby|per_page)/i;
  if (keys.some((k) => FACET.test(k))) return 'faceted';
  if (keys.length) return 'param';
  if ((ev.bytes || 0) > 0 && ev.bytes < 1024 && s === 200) return 'soft-404'; // tiny 200 body = likely soft-404
  return 'ok';
}

/** Build a fast IPv4 CIDR membership for Googlebot (uses aibot-ips verifyBot). */
function makeGooglebotVerifier(ranges) {
  return (ip) => (ranges?.Googlebot?.cidrs ? verifyBot(ip, 'Googlebot', ranges).verified : null);
}

/**
 * Analyze crawl budget for a client from its access-event store.
 *
 * @param {object} cfg
 * @param {object} opts
 * @param {(s:string)=>void} [opts.log]
 * @param {object} [opts.ranges]   pre-fetched aibot-ips ranges (else fetched once)
 * @param {boolean} [opts.fetchRanges=true]  fetch vendor IP ranges for verification
 * @returns {Promise<object>} the crawl-budget report (also written to disk)
 */
export async function analyzeCrawlBudget(cfg, { log = () => {}, ranges = null, fetchRanges = true } = {}) {
  log(`Crawl-budget analysis · ${cfg.brand} …`);

  // 1) Strategic URL set from sitemaps + internal-link reachability (orphan join).
  const { urls: sitemapUrls = [] } = await discoverUrls(cfg).catch(() => ({ urls: [] }));
  const sitemapSet = new Set(sitemapUrls.map(norm));

  let reachable = new Set();   // internal-link-reachable pages
  let orphansFromLinks = [];
  try {
    const lk = await analyzeLinks(cfg, { log: () => {} });
    reachable = new Set((lk.ranked || []).filter((r) => r.inlinks > 0).map((r) => norm(r.url)));
    orphansFromLinks = (lk.orphans || []).map((r) => norm(r.url));
  } catch (e) { log(`  (links graph unavailable: ${String(e.message || e).slice(0, 80)})`); }

  // 2) Verified-bot ranges (Googlebot needs forward-confirmed CIDR; aibot-ips supplies AI bots + Googlebot if present).
  if (fetchRanges && !ranges) { try { ranges = await fetchBotRanges({ log: () => {} }); } catch { ranges = null; } }
  const isGoogle = makeGooglebotVerifier(ranges);

  // 3) Single streaming pass over the event store.
  const GOOGLE_UA = /Googlebot/i;
  const templates = new Map();          // tmpl -> { hits, buckets{}, statuses{}, urls:Set }
  const crawledStrategic = new Set();   // strategic URLs a VERIFIED Googlebot fetched (2xx)
  const seenInLogs = new Set();         // every path seen (any UA)
  let totalBotHits = 0, googlebotHits = 0, googlebotVerified = 0, googlebotSpoofed = 0;

  const bump = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

  let eventsStoreError = null;
  try {
    for await (const ev of readEvents(cfg.name)) {
      if (!ev || typeof ev !== 'object') continue;
      const path = ev.path || '';
      if (!path) continue;
      const fullUrl = norm(`${cfg.baseUrl}${path.startsWith('/') ? path : '/' + path}`.split('?')[0]);
      seenInLogs.add(fullUrl);

      const ua = ev.ua || '';
      const isBot = /bot|crawl|spider|gptbot|claudebot|perplexity|oai-search|chatgpt|google-extended|bingbot|amazonbot|applebot|ccbot|bytespider/i.test(ua);
      if (!isBot) continue;
      totalBotHits++;

      const tmpl = urlTemplate(path);
      const t = templates.get(tmpl) || { template: tmpl, hits: 0, buckets: {}, statuses: {}, urls: new Set() };
      t.hits++; bump(t.buckets, wasteBucket(ev)); bump(t.statuses, String(ev.status || 0)); t.urls.add(fullUrl);
      templates.set(tmpl, t);

      if (GOOGLE_UA.test(ua)) {
        googlebotHits++;
        const verified = isGoogle(ev.ip);
        if (verified === true) { googlebotVerified++; if ((ev.status || 0) < 400) crawledStrategic.add(fullUrl); }
        else if (verified === false) googlebotSpoofed++;
        else if ((ev.status || 0) < 400) crawledStrategic.add(fullUrl); // ranges unavailable → trust UA (best-effort)
      }
    }
  } catch (e) {
    eventsStoreError = String(e.message || e).slice(0, 120);
    log(`  (access-event store unavailable: ${eventsStoreError})`);
  }

  // Early-exit when the event store is empty or unconfigured — avoids writing a
  // misleading all-zeros report and makes the "no data" condition explicit.
  if (seenInLogs.size === 0 && totalBotHits === 0) {
    const noDataReport = {
      client: cfg.name, brand: cfg.brand, baseUrl: cfg.baseUrl, ranAt: nowIso(),
      noData: true,
      noDataReason: eventsStoreError ? `store error: ${eventsStoreError}` : 'access-event store is empty or has not been configured',
    };
    log('  no access-log data available — skipping crawl-budget analysis');
    return noDataReport;
  }

  // 4) Crawl ratio: of the strategic (sitemap) URLs, how many did Googlebot fetch?
  const strategicCrawled = [...sitemapSet].filter((u) => crawledStrategic.has(u));
  const crawlRatio = sitemapSet.size ? pct(strategicCrawled.length, sitemapSet.size) : 0;

  // 5) Per-template waste % + rollup.
  const perTemplate = [...templates.values()].map((t) => {
    const waste = Object.entries(t.buckets).filter(([k]) => k !== 'ok').reduce((s, [, n]) => s + n, 0);
    return {
      template: t.template, hits: t.hits, uniqueUrls: t.urls.size,
      wastePct: pct(waste, t.hits), buckets: t.buckets, statuses: t.statuses,
      sampleUrls: [...t.urls].slice(0, 5),
    };
  }).sort((a, b) => b.wastePct - a.wastePct || b.hits - a.hits);

  const totalWaste = perTemplate.reduce((s, t) => s + (t.buckets ? Object.entries(t.buckets).filter(([k]) => k !== 'ok').reduce((x, [, n]) => x + n, 0) : 0), 0);
  const wasteByBucket = {};
  for (const t of perTemplate) for (const [k, n] of Object.entries(t.buckets)) if (k !== 'ok') wasteByBucket[k] = (wasteByBucket[k] || 0) + n;

  // 6) Orphans + never-crawled set-joins.
  //    never-crawled strategic = sitemap URLs no verified bot fetched.
  const neverCrawled = [...sitemapSet].filter((u) => !crawledStrategic.has(u));
  //    orphan = in (logs ∪ sitemap) but NOT internal-link-reachable.
  const universe = new Set([...seenInLogs, ...sitemapSet]);
  const orphans = [...universe].filter((u) => hostOf(u) === hostOf(cfg.baseUrl) && !reachable.has(u));
  //    crawled-but-not-in-sitemap = bot spent budget on URLs we don't even advertise.
  const crawledOffSitemap = [...crawledStrategic].filter((u) => !sitemapSet.has(u));

  const report = {
    client: cfg.name, brand: cfg.brand, baseUrl: cfg.baseUrl, ranAt: nowIso(),
    window: { sitemapUrls: sitemapSet.size, eventsSeenPaths: seenInLogs.size },
    bots: { totalBotHits, googlebotHits, googlebotVerified, googlebotSpoofed, rangesAvailable: !!ranges?.Googlebot?.cidrs },
    crawlRatio, strategicCrawled: strategicCrawled.length,
    waste: { totalWasteHits: totalWaste, wastePct: pct(totalWaste, totalBotHits), byBucket: wasteByBucket },
    templates: perTemplate.slice(0, 60),
    neverCrawled: neverCrawled.slice(0, 200),
    neverCrawledCount: neverCrawled.length,
    orphans: orphans.slice(0, 200),
    orphanCount: orphans.length,
    orphansFromLinks: orphansFromLinks.slice(0, 50),
    crawledOffSitemap: crawledOffSitemap.slice(0, 100),
  };

  writeReport(cfg, report);
  log(`  crawl ratio ${crawlRatio}% · waste ${report.waste.wastePct}% (${totalWaste} hits) · ${neverCrawled.length} never-crawled · ${orphans.length} orphans`);
  log(`  Googlebot: ${googlebotHits} hits (${googlebotVerified} verified${googlebotSpoofed ? `, ${googlebotSpoofed} SPOOFED` : ''})`);
  return report;
}

function writeReport(cfg, r) {
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'crawlbudget.json'), JSON.stringify(r, null, 2));

  const L = [`# Crawl budget — ${r.brand}`, `${r.baseUrl} · ${new Date(r.ranAt).toUTCString()} · from our own access logs`, ''];
  L.push(`- **Crawl ratio:** ${r.crawlRatio}% of ${r.window.sitemapUrls} sitemap URLs fetched by verified Googlebot`);
  L.push(`- **Crawl waste:** ${r.waste.wastePct}% of ${r.bots.totalBotHits} bot hits (${r.waste.totalWasteHits} wasted)`);
  L.push(`- **Never-crawled strategic URLs:** ${r.neverCrawledCount}`);
  L.push(`- **Orphans (in logs/sitemap, no internal links):** ${r.orphanCount}`);
  if (r.bots.googlebotSpoofed) L.push(`- ⚠ **${r.bots.googlebotSpoofed} spoofed Googlebot hits** (UA claimed Googlebot, IP not in Google's range)`);
  L.push('', '## Waste by bucket');
  const bk = Object.entries(r.waste.byBucket).sort((a, b) => b[1] - a[1]);
  if (!bk.length) L.push('- none 🎉'); else for (const [k, n] of bk) L.push(`- ${k}: ${n}`);
  L.push('', '## Per-template (highest waste first)', '', '| Template | Hits | Waste % | Buckets |', '|---|---|---|---|');
  for (const t of r.templates.slice(0, 25)) L.push(`| ${t.template} | ${t.hits} | ${t.wastePct}% | ${Object.entries(t.buckets).filter(([k]) => k !== 'ok').map(([k, n]) => `${k}:${n}`).join(' ') || '—'} |`);
  if (r.neverCrawled.length) { L.push('', `## Never-crawled strategic URLs (${r.neverCrawledCount})`, ''); r.neverCrawled.slice(0, 25).forEach((u) => L.push(`- ${u}`)); }
  if (r.orphans.length) { L.push('', `## Orphan URLs (${r.orphanCount}) — add internal links`, ''); r.orphans.slice(0, 25).forEach((u) => L.push(`- ${u}`)); }
  writeFileSync(join(dir, 'crawlbudget.md'), L.join('\n'));
}

// ---------------------------------------------------------------------------
// waste → proposals  (flows into the existing decide/apply pipeline)
// ---------------------------------------------------------------------------

/**
 * Turn a crawl-budget report into proposal objects shaped exactly like decide.mjs
 * proposals so they flow through priority.rankProposals / apply unchanged:
 *   { id?, type, page, severity, current, proposed, rationale, autoApplicable:false, source:'crawlbudget' }
 * type ∈ 'robots-disallow' | 'redirect' | 'canonical'.  Always autoApplicable:false
 * (crawl-control changes are never auto-applied — they can deindex pages).
 *
 * @param {object} report  output of analyzeCrawlBudget
 * @param {object} [opts]
 * @param {number} [opts.startId=0]  id offset so ids don't collide with audit proposals
 * @returns {Array<object>} proposals
 */
export function wasteToProposals(report, { startId = 0 } = {}) {
  const proposals = [];
  let id = startId;
  if (!report) return proposals;

  // 1) Faceted/param templates burning budget → robots Disallow the param pattern.
  for (const t of report.templates || []) {
    const facet = (t.buckets?.faceted || 0) + (t.buckets?.param || 0);
    if (facet >= 3 && (t.wastePct >= 30)) {
      const sev = facet >= 20 ? 'high' : 'medium';
      proposals.push({
        id: ++id, type: 'robots-disallow', page: report.baseUrl, severity: sev, autoApplicable: false, source: 'crawlbudget',
        current: `${facet} bot fetches of faceted/param URLs under template ${t.template} (waste ${t.wastePct}%)`,
        proposed: `Add a robots.txt Disallow for the parameterized variants of ${t.template} (e.g. Disallow: /*?*filter= , *sort= , *page=) and/or rel=canonical to the clean URL.`,
        rationale: 'Faceted/param URLs consume crawl budget without unique value; blocking them concentrates budget on strategic pages.',
        evidence: { template: t.template, sampleUrls: t.sampleUrls, buckets: t.buckets },
      });
    }
  }

  // 2) 4xx/5xx churn per template → redirect (4xx) or fix (5xx).
  for (const t of report.templates || []) {
    const e4 = t.buckets?.['4xx'] || 0, e5 = t.buckets?.['5xx'] || 0;
    if (e4 >= 3) proposals.push({
      id: ++id, type: 'redirect', page: t.sampleUrls?.[0] || report.baseUrl, severity: e4 >= 20 ? 'high' : 'medium', autoApplicable: false, source: 'crawlbudget',
      current: `${e4} bot hits returning 4xx under ${t.template}`,
      proposed: `301-redirect the broken URLs to their nearest live equivalent, or return 410 if intentionally gone (so crawlers stop retrying).`,
      rationale: 'Bots wasting budget on 404s is pure loss; 301/410 reclaims it and removes dead URLs from the index.',
      evidence: { template: t.template, sampleUrls: t.sampleUrls, count: e4 },
    });
    if (e5 >= 1) proposals.push({
      id: ++id, type: 'redirect', page: t.sampleUrls?.[0] || report.baseUrl, severity: 'critical', autoApplicable: false, source: 'crawlbudget',
      current: `${e5} bot hits returning 5xx under ${t.template}`,
      proposed: `Investigate and fix the server errors on ${t.template} — 5xx to crawlers can drop pages from the index.`,
      rationale: 'Server errors served to verified crawlers are the most damaging crawl-waste class.',
      evidence: { template: t.template, sampleUrls: t.sampleUrls, count: e5 },
    });
  }

  // 3) 3xx redirect chains burning budget → canonical / single-hop.
  for (const t of report.templates || []) {
    const e3 = t.buckets?.['3xx'] || 0;
    if (e3 >= 5) proposals.push({
      id: ++id, type: 'canonical', page: t.sampleUrls?.[0] || report.baseUrl, severity: 'low', autoApplicable: false, source: 'crawlbudget',
      current: `${e3} bot hits hitting 3xx redirects under ${t.template}`,
      proposed: `Point internal links and the sitemap at the final destination URL (collapse the redirect hop) and set rel=canonical.`,
      rationale: 'Each redirect hop costs a crawl request; linking to the final URL saves budget.',
      evidence: { template: t.template, sampleUrls: t.sampleUrls, count: e3 },
    });
  }

  return proposals;
}
