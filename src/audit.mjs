// seo-bot · audit orchestration — crawl a site, run every rule, score it.

import { discoverUrls, fetchPages } from './crawl.mjs';
import { auditPage, auditSite } from './rules.mjs';
import { nowIso } from './util.mjs';

const WEIGHT = { critical: 15, high: 8, medium: 3, low: 1, info: 0 };

/**
 * Aggregate a flat findings array into a byRule map.
 * Each entry tracks count + the HIGHEST severity seen for that rule.
 * Exported for unit-testing.
 */
export function aggregateByRule(allFindings) {
  const byRule = {};
  for (const fnd of allFindings) {
    if (!byRule[fnd.rule]) {
      byRule[fnd.rule] = { rule: fnd.rule, count: 0, severity: fnd.severity, recommendation: fnd.recommendation };
    } else if ((WEIGHT[fnd.severity] || 0) > (WEIGHT[byRule[fnd.rule].severity] || 0)) {
      byRule[fnd.rule].severity = fnd.severity;
    }
    byRule[fnd.rule].count++;
  }
  return byRule;
}

/** Run a full audit for a client config. Returns a structured result object. */
export async function runAudit(cfg, { log = () => {} } = {}) {
  log(`Discovering URLs for ${cfg.domain} …`);
  const { urls, robots, robotsFound, sitemapFound } = await discoverUrls(cfg);
  log(`  ${urls.length} URLs to audit (sitemap ${sitemapFound ? 'found' : 'MISSING'}, robots ${robotsFound ? 'found' : 'missing'}).`);

  log(`Fetching pages (raw HTML, no JS) …`);
  const fetched = await fetchPages(urls, cfg);

  const pages = fetched.map((pg) => auditPage(pg, cfg));
  const siteFindings = auditSite({ robots, robotsFound, sitemapFound, pages }, cfg);

  // Aggregate
  const allFindings = [];
  for (const fnd of siteFindings) allFindings.push({ ...fnd, scope: 'site', url: cfg.baseUrl });
  for (const pr of pages) for (const fnd of pr.findings) allFindings.push({ ...fnd, scope: 'page', url: pr.url });

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const fnd of allFindings) {
    bySeverity[fnd.severity] = (bySeverity[fnd.severity] || 0) + 1;
  }
  const byRule = aggregateByRule(allFindings);

  // Health score: 100 minus weighted penalties, normalized to page count so a big
  // site isn't punished merely for size (per-page issues are averaged).
  const pagePenalty = pages.reduce((sum, pr) => sum + pr.findings.reduce((s, fn) => s + (WEIGHT[fn.severity] || 0), 0), 0);
  const sitePenalty = siteFindings.reduce((s, fn) => s + (WEIGHT[fn.severity] || 0), 0);
  const avgPagePenalty = pages.length ? pagePenalty / pages.length : 0;
  const score = Math.max(0, Math.round(100 - avgPagePenalty - sitePenalty));

  return {
    client: cfg.name,
    brand: cfg.brand,
    baseUrl: cfg.baseUrl,
    ranAt: nowIso(),
    sitemapFound,
    robotsFound,
    robots,
    pageCount: pages.length,
    score,
    bySeverity,
    byRule: Object.values(byRule).sort((a, b) => b.count - a.count),
    siteFindings,
    pages,
    allFindings,
  };
}
