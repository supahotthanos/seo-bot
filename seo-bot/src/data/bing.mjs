// seo-bot · data/bing — Bing Webmaster Tools connector (FREE). The big win is
// GetKeywordStats: real keyword search-volume history with no Ahrefs/DataForSEO bill.
// Also gives Bing's own query/traffic stats (a free second source alongside GSC) and
// URL submission (complements IndexNow). Powers Bing + Copilot answers.
//
// Setup: Bing Webmaster Tools → Settings → API access → generate an API key →
//   export BING_WEBMASTER_API_KEY="..."   (free). Add bing.siteUrl to the client config.
//
// API: GET/POST https://ssl.bing.com/webmaster/api.svc/json/{Method}?apikey=KEY
// Bing wraps JSON results in { "d": ... }.

const BASE = 'https://ssl.bing.com/webmaster/api.svc/json';

function bingKey(cfg) { return process.env.BING_WEBMASTER_API_KEY || cfg?.bing?.apiKey; }
function siteUrl(cfg) { return cfg?.bing?.siteUrl || cfg?.baseUrl; }

async function bingGet(key, method, params = {}) {
  const qs = new URLSearchParams({ apikey: key, ...params });
  const res = await fetch(`${BASE}/${method}?${qs.toString()}`, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = {}; }
  if (!res.ok) throw new Error(`Bing ${method} ${res.status}: ${text.slice(0, 160)}`);
  return j.d ?? j;
}

async function bingPost(key, method, body) {
  const res = await fetch(`${BASE}/${method}?apikey=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bing ${method} ${res.status}: ${text.slice(0, 160)}`);
  try { return (JSON.parse(text)).d; } catch { return text; }
}

/** FREE keyword search-volume history for a query. The Ahrefs-replacement lever. */
export async function bingKeywordStats(cfg, query, { country = 'us', language = 'en-US', log = () => {} } = {}) {
  const key = bingKey(cfg);
  if (!key) return { enabled: false, note: 'set BING_WEBMASTER_API_KEY (free, from Bing Webmaster Tools → API access)' };
  try {
    const d = await bingGet(key, 'GetKeywordStats', { q: query, country, language });
    const rows = (Array.isArray(d) ? d : []).map((r) => ({ query: r.Query || query, impressions: r.Impressions ?? r.Broad ?? null, date: r.Date ? new Date(parseInt((String(r.Date).match(/\d+/) || [])[0] || 0)).toISOString().slice(0, 10) : null }));
    log(`  Bing keyword "${query}": ${rows.length} data points (free search-volume history).`);
    return { enabled: true, query, points: rows };
  } catch (e) { return { enabled: false, note: String(e.message || e) }; }
}

/** Bing's per-query impressions/clicks/position for the site (free GSC-equivalent). */
export async function bingQueryStats(cfg, { log = () => {} } = {}) {
  const key = bingKey(cfg); if (!key) return { enabled: false, note: 'set BING_WEBMASTER_API_KEY' };
  try {
    const d = await bingGet(key, 'GetQueryStats', { siteUrl: siteUrl(cfg) });
    const rows = (Array.isArray(d) ? d : []).map((r) => ({ query: r.Query, impressions: r.Impressions, clicks: r.Clicks, avgPosition: r.AvgImpressionPosition ?? r.Position }));
    log(`  Bing: ${rows.length} queries for ${siteUrl(cfg)}.`);
    return { enabled: true, queries: rows };
  } catch (e) { return { enabled: false, note: String(e.message || e) }; }
}

/** Daily rank + traffic (impressions/clicks) for the site. */
export async function bingRankAndTraffic(cfg, { log = () => {} } = {}) {
  const key = bingKey(cfg); if (!key) return { enabled: false, note: 'set BING_WEBMASTER_API_KEY' };
  try {
    const d = await bingGet(key, 'GetRankAndTrafficStats', { siteUrl: siteUrl(cfg) });
    return { enabled: true, days: Array.isArray(d) ? d.length : 0, raw: d };
  } catch (e) { return { enabled: false, note: String(e.message || e) }; }
}

/** Submit URLs to Bing for (re)crawl — complements IndexNow. Daily quota applies. */
export async function bingSubmitUrls(cfg, urls = [], { log = () => {} } = {}) {
  const key = bingKey(cfg); if (!key) return { enabled: false, note: 'set BING_WEBMASTER_API_KEY' };
  const list = urls.filter(Boolean);
  if (!list.length) return { enabled: true, submitted: 0 };
  try {
    await bingPost(key, 'SubmitUrlbatch', { siteUrl: siteUrl(cfg), urlList: list });
    log(`  Bing: submitted ${list.length} URLs for crawl.`);
    return { enabled: true, submitted: list.length };
  } catch (e) { return { enabled: false, note: String(e.message || e) }; }
}
