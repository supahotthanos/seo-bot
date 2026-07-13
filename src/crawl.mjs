// seo-bot · crawl — discover URLs from sitemaps/robots, fetch RAW HTML, and
// analyze robots.txt for AI-crawler blocks. No JS rendering by design.

import { fetchPage, absUrl, sameSite, sleep, hostOf } from './util.mjs';

// The crawlers that matter for AI answer engines + classic search. If robots.txt
// disallows any of these, the site is invisible to that engine — a critical bug.
export const AI_CRAWLERS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',          // OpenAI / ChatGPT
  'ClaudeBot', 'Claude-SearchBot', 'Claude-User',      // Anthropic / Claude
  'PerplexityBot', 'Perplexity-User',                  // Perplexity
  'Google-Extended', 'Googlebot', 'Google-CloudVertexBot',
  'Bingbot', 'Amazonbot', 'Applebot', 'CCBot',
];

/** Parse a robots.txt body → { sitemaps:[], blockedAICrawlers:[], blocksAll:bool }. */
export function parseRobots(body) {
  const out = { sitemaps: [], blockedAICrawlers: [], blocksAll: false };
  if (!body) return out;
  const lines = body.split(/\r?\n/);
  let curAgents = [];
  const groups = []; // {agents:[], disallows:[]}
  let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const val = m[2].trim();
    if (field === 'sitemap') { out.sitemaps.push(val); continue; }
    if (field === 'user-agent') {
      if (cur && cur._closed) { cur = null; }
      if (!cur) { cur = { agents: [], disallows: [] }; groups.push(cur); }
      cur.agents.push(val);
      curAgents = cur.agents;
      continue;
    }
    if (field === 'disallow' || field === 'allow') {
      if (!cur) { cur = { agents: ['*'], disallows: [] }; groups.push(cur); }
      cur._closed = true;
      if (field === 'disallow') cur.disallows.push(val);
    }
  }
  // For each AI crawler, find the most specific matching group and see if it blocks "/"
  for (const bot of AI_CRAWLERS) {
    const matching = groups.filter((g) => g.agents.some((a) => a === '*' || a.toLowerCase() === bot.toLowerCase()));
    // prefer an exact-name group over the wildcard
    const exact = matching.find((g) => g.agents.some((a) => a.toLowerCase() === bot.toLowerCase()));
    const group = exact || matching.find((g) => g.agents.includes('*'));
    if (group && group.disallows.some((d) => d === '/' || d === '/*')) out.blockedAICrawlers.push(bot);
  }
  out.blocksAll = groups.some((g) => g.agents.includes('*') && g.disallows.some((d) => d === '/' || d === '/*'));
  return out;
}

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;

export function extractLocs(xml) {
  const out = [];
  // Reset lastIndex before each use — the module-level /g regex retains state
  // across calls and would alternate-miss on consecutive invocations otherwise.
  LOC_RE.lastIndex = 0;
  let m;
  while ((m = LOC_RE.exec(xml))) out.push(m[1].trim());
  return out;
}

/** Recursively expand a sitemap (handles sitemap-index files). */
async function expandSitemap(url, cfg, seen = new Set(), depth = 0) {
  if (depth > 3 || seen.has(url)) return [];
  seen.add(url);
  const res = await fetchPage(url, { timeoutMs: 20000 });
  if (!res.ok || !res.text) return [];
  const isIndex = /<sitemapindex/i.test(res.text);
  const locs = extractLocs(res.text);
  if (isIndex) {
    const all = [];
    for (const loc of locs.slice(0, 25)) {
      all.push(...(await expandSitemap(loc, cfg, seen, depth + 1)));
      await sleep(120);
    }
    return all;
  }
  return locs;
}

function pathAllowed(url, cfg) {
  let path;
  try { path = new URL(url).pathname; } catch { return false; }
  const a = cfg.audit;
  if (a.excludePaths?.some((p) => path.startsWith(p))) return false;
  if (a.includePaths?.length && !a.includePaths.some((p) => path.startsWith(p))) return false;
  return true;
}

/** Evenly sample up to n items (keep first = homepage, then spread). */
function sample(arr, n) {
  // Guard degenerate n: 0, NaN, or non-finite all silently emptied the result
  // before this fix, discarding even the homepage. Always keep at least 1.
  if (!Number.isFinite(n) || n <= 0) return arr.slice(0, 1);
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return [...new Set(out)];
}

/** Discover the URL set to audit. Returns { urls, robots, sitemapFound }. */
export async function discoverUrls(cfg) {
  const robotsRes = await fetchPage(`${cfg.baseUrl}/robots.txt`, { timeoutMs: 12000 });
  const robots = parseRobots(robotsRes.ok ? robotsRes.text : '');
  const robotsFound = robotsRes.ok && robotsRes.status === 200;

  const sitemapList = [...new Set([...(cfg.sitemaps || []), ...robots.sitemaps])];
  let urls = [];
  for (const sm of sitemapList) {
    urls.push(...(await expandSitemap(sm, cfg)));
  }
  const sitemapFound = urls.length > 0;
  urls = [...new Set(urls)].filter((u) => sameSite(u, cfg.baseUrl) && pathAllowed(u, cfg));

  // Always include the homepage.
  if (!urls.includes(cfg.baseUrl) && !urls.includes(cfg.baseUrl + '/')) urls.unshift(cfg.baseUrl);
  if (!sitemapFound) urls = [cfg.baseUrl];

  urls = sample(urls, cfg.audit.maxPages);
  return { urls, robots, robotsFound, sitemapFound };
}

/** Fetch raw HTML for each URL, politely (sequential w/ delay). */
export async function fetchPages(urls, cfg) {
  const pages = [];
  for (const url of urls) {
    const res = await fetchPage(url, { timeoutMs: 15000 });
    pages.push({ url, status: res.status, ok: res.ok, ms: res.ms, html: res.text, error: res.error, finalUrl: res.finalUrl });
    await sleep(cfg.audit.politenessMs || 350);
  }
  return pages;
}
