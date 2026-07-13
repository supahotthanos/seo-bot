// seo-bot · inspect — GSC URL Inspection API. Per-URL ground truth: is the page
// actually indexed, when was it last crawled, what canonical did Google pick, did rich
// results validate. The #1 diagnostic the audit can't get from raw HTML — a new
// service/location page can't rank or be AI-cited if it isn't indexed.
//
// Uses the OAuth token already minted by `connect <client>` (scope webmasters.readonly,
// which IS sufficient for inspection). Note: the v1 host differs from gsc.mjs's v3 path.
// Quota: 2000/day + 600/min per property → inspect the highest-opportunity pages only.

import { getAccessToken } from './connect/google.mjs';

const ENDPOINT = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

export async function inspectUrl(cfg, url, { log = () => {} } = {}) {
  const token = await getAccessToken(cfg.name);
  if (!token) return { enabled: false, note: 'not connected — run `connect ' + cfg.name + '` first' };
  const siteUrl = cfg.gsc?.siteUrl || cfg.baseUrl;
  try {
    const r = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ inspectionUrl: url, siteUrl, languageCode: 'en-US' }) });
    const j = await r.json();
    if (!r.ok) return { enabled: false, note: j.error?.message || `status ${r.status}`, quota: r.status === 429 };
    const res = j.inspectionResult || {};
    const idx = res.indexStatusResult || {};
    return { enabled: true, url, verdict: idx.verdict, coverageState: idx.coverageState, lastCrawl: idx.lastCrawlTime || null, googleCanonical: idx.googleCanonical || null, userCanonical: idx.userCanonical || null, robotsTxtState: idx.robotsTxtState, indexingState: idx.indexingState, richResults: res.richResultsResult?.verdict || 'none', mobileUsability: res.mobileUsabilityResult?.verdict || 'n/a' };
  } catch (e) { return { enabled: false, note: String(e.message || e) }; }
}

export async function inspectSite(cfg, { log = () => {}, max = 20 } = {}) {
  const { discoverUrls } = await import('./crawl.mjs');
  const { urls } = await discoverUrls(cfg);
  const targets = urls.slice(0, max);
  log(`Inspecting ${targets.length} URLs against GSC index …`);
  const out = [];
  for (const u of targets) {
    const r = await inspectUrl(cfg, u, { log });
    out.push(r);
    if (!r.enabled) { log(`  ${r.note}${r.quota ? ' (quota — stopping)' : ''}`); if (!r.quota && out.length === 1) return { enabled: false, note: r.note }; break; }
    log(`  ${r.verdict === 'PASS' ? '✅' : '⚠️ '} ${r.coverageState || '?'} — ${u}`);
  }
  const live = out.filter((r) => r.enabled);
  const notIndexed = live.filter((r) => r.verdict !== 'PASS' || /not indexed/i.test(r.coverageState || ''));
  log(`\n  ${live.length} inspected · ${notIndexed.length} NOT indexed → IndexNow + check thin/dup content`);
  return { enabled: live.length > 0, inspected: live.length, notIndexed: notIndexed.map((r) => ({ url: r.url, state: r.coverageState })), results: live };
}
