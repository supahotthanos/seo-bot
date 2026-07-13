// seo-bot · agent-analytics — server-log AI-crawler intelligence: Profound's paid
// "Agent Analytics" rebuilt for free from the access logs the client already owns.
// Parses combined/common Apache-Nginx lines AND JSON-lines drains (Vercel + Cloudflare
// Logpush shapes), classifies every hit against the AI_CRAWLERS registry, verifies the
// claimed bot against the vendors' published IP ranges (connect/aibot-ips), and builds
// the per-crawler × per-page fetch matrix + never-fetched money pages + crawl→citation
// lag. Evidence: research/aeo-deep-research-2026.md (crawl-before-cite retrieval layer),
// research/ai-observation-stealth-2026.md (UA spoofing is rampant → verify by CIDR).
//
// FAIL-CLOSED INVARIANTS (do not weaken):
//   • Malformed log lines are skipped AND counted (skippedCount) — never silently dropped.
//   • A UA that claims a bot but whose IP fails range verification is 'spoofed' and is
//     EXCLUDED from verified-crawl counts — spoofed traffic must never inflate
//     "AI reads us" numbers, and a page hit only by spoofed traffic stays never-fetched.
//   • No IP ranges available → 'unverified' class, reported separately, never merged
//     into verified.
//   • Never-fetched + crawl→citation lag are computed from VERIFIED hits ONLY — a ranges
//     outage (fetch failure) makes those sections not-computable (caveat printed ON the
//     sections), never a report built on unverifiable UA claims.
//   • An empty/unparseable log fails closed with a message — no report is written.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';
import { AI_CRAWLERS } from './crawl.mjs';
import { parseCombinedLine, parseVercelDrainObject, eventsStorePath, loadEvents } from './connect/logs.mjs';
import { fetchBotRanges, verifyBot } from './connect/aibot-ips.mjs';

// Human-triggered fetchers (a person asked the assistant to open the page — real-time
// retrieval, not index crawling). Reported as their own class, never merged into crawls.
export const USER_FETCH_AGENTS = new Set(['ChatGPT-User', 'Claude-User', 'Perplexity-User']);

// Longest-first so a more specific token can never lose to a shorter sibling.
const AGENT_PATTERNS = [...AI_CRAWLERS]
  .sort((a, b) => b.length - a.length)
  .map((name) => ({ name, re: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }));

// Which key in the aibot-ips ranges object verifies a given agent. Anthropic publishes
// ONE bots.json covering its crawler family, so Claude-* fall back to the ClaudeBot key
// when they have no key of their own.
const RANGE_FALLBACK = { 'Claude-SearchBot': 'ClaudeBot', 'Claude-User': 'ClaudeBot' };

function rangeKeyFor(agent, ranges) {
  if (!ranges || typeof ranges !== 'object') return null;
  if (ranges[agent]?.cidrs?.length) return agent;
  const fb = RANGE_FALLBACK[agent];
  if (fb && ranges[fb]?.cidrs?.length) return fb;
  return null;
}

// --- Cloudflare Logpush (HTTP requests dataset) JSON object → flat event -----------
function toPathOnly(v) {
  if (!v) return '';
  if (v.startsWith('/')) return v;
  try { const u = new URL(v); return u.pathname + u.search; } catch { return v; }
}

/** Cloudflare EdgeStartTimestamp can be RFC3339, unix seconds, ms, or nanoseconds. */
function cfTimestampToIso(t) {
  if (t == null) return null;
  if (typeof t === 'string') { const d = new Date(t); return Number.isNaN(+d) ? null : d.toISOString(); }
  if (!Number.isFinite(t)) return null;
  let ms = t;
  if (t > 1e17) ms = t / 1e6;        // nanoseconds
  else if (t > 1e14) ms = t / 1e3;   // microseconds
  else if (t < 1e12) ms = t * 1e3;   // seconds
  const d = new Date(ms);
  return Number.isNaN(+d) ? null : d.toISOString();
}

/** Normalize one Cloudflare Logpush JSON object → event or null. */
export function parseCloudflareObject(o) {
  if (!o || typeof o !== 'object') return null;
  const uri = o.ClientRequestURI ?? o.ClientRequestPath;
  if (uri == null || !('ClientIP' in o || 'EdgeResponseStatus' in o || 'ClientRequestMethod' in o)) return null;
  return {
    ts: cfTimestampToIso(o.EdgeStartTimestamp ?? o.EdgeEndTimestamp) || '',
    ip: o.ClientIP || '',
    method: o.ClientRequestMethod || 'GET',
    path: toPathOnly(String(uri)),
    status: Number(o.EdgeResponseStatus ?? 0) || 0,
    bytes: Number(o.EdgeResponseBytes ?? 0) || 0,
    ua: o.ClientRequestUserAgent || '',
    referer: o.ClientRequestReferer || '',
  };
}

/**
 * Parse raw access-log text (or an array of lines) into normalized events.
 * Formats: 'combined' (Apache/Nginx combined+common), 'json' (JSON-lines: Vercel drain
 * or Cloudflare Logpush shapes), 'auto' (per-line sniff). Defensive: a line that fails
 * to parse — or parses without a request path — is skipped AND counted, never silently
 * dropped.
 *
 * @param {string|string[]} input
 * @param {{format?: 'auto'|'combined'|'json'}} [opts]
 * @returns {{entries: object[], skippedCount: number, readCount: number, format: string}}
 */
export function parseLogLines(input, { format = 'auto' } = {}) {
  const lines = Array.isArray(input) ? input : String(input ?? '').split(/\r?\n/);
  const entries = [];
  let skippedCount = 0, readCount = 0;

  const parseJsonLine = (s) => {
    let o;
    try { o = JSON.parse(s); } catch { return null; }
    return parseVercelDrainObject(o) || parseCloudflareObject(o);
  };

  for (const raw of lines) {
    const s = String(raw ?? '').trim();
    if (!s) continue; // blank line = no data, not a malformed record
    readCount++;
    let ev = null;
    if (format === 'combined') ev = parseCombinedLine(s);
    else if (format === 'json') ev = parseJsonLine(s);
    else ev = s[0] === '{' ? parseJsonLine(s) : parseCombinedLine(s);
    if (!ev || !ev.path) { skippedCount++; continue; }
    entries.push(ev);
  }
  return { entries, skippedCount, readCount, format };
}

/**
 * Classify one hit: which AI agent (if any), and can we trust the claim?
 *
 * Classes:
 *   'verified'   — UA matches a crawler AND its IP is inside the vendor's published CIDRs.
 *   'spoofed'    — UA claims an agent, ranges ARE available, IP fails → excluded from
 *                  every verified/fetched count (fail-closed).
 *   'unverified' — UA matches a crawler but no IP ranges are available for it; reported
 *                  separately, never merged into verified.
 *   'user-fetch' — a human-triggered fetcher (ChatGPT-User / Perplexity-User / Claude-User);
 *                  its own class (verification field still says verified/unverified).
 *   'other'      — not an AI agent.
 *
 * @param {string} ua
 * @param {string} ip
 * @param {object|null} ranges  fetchBotRanges() result (or null when unavailable)
 * @returns {{agent: string|null, kind: 'crawler'|'user-fetch'|null,
 *            verification: 'verified'|'spoofed'|'unverified'|null, class: string}}
 */
export function classifyAgent(ua, ip, ranges = null) {
  const s = String(ua || '');
  const hit = AGENT_PATTERNS.find((p) => p.re.test(s));
  if (!hit) return { agent: null, kind: null, verification: null, class: 'other' };
  const agent = hit.name;
  const kind = USER_FETCH_AGENTS.has(agent) ? 'user-fetch' : 'crawler';

  let verification = 'unverified';
  const key = rangeKeyFor(agent, ranges);
  if (key && ip) {
    verification = verifyBot(String(ip), key, ranges).verified ? 'verified' : 'spoofed';
  } else if (key && !ip) {
    // ranges exist but the log line carries no IP → cannot verify; fail closed to spoofed?
    // No: absence of an IP is a log-format limitation, not evidence of forgery. Report
    // unverified (still excluded from verified counts).
    verification = 'unverified';
  }

  const cls = verification === 'spoofed' ? 'spoofed' : kind === 'user-fetch' ? 'user-fetch' : verification;
  return { agent, kind, verification, class: cls };
}

// --- aggregation --------------------------------------------------------------------

/** Normalize any URL/path to a comparable path: no query/hash, no trailing slash (except root). */
export function normPath(v) {
  let p = toPathOnly(String(v || ''));
  p = p.split('#')[0].split('?')[0];
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p;
}

const tsMs = (ts) => { const n = Date.parse(ts || ''); return Number.isFinite(n) ? n : null; };

function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** Accept several citations-report shapes → [{path, ms}] (URL-level rows only). */
function normalizeCitations(citations) {
  if (!citations) return [];
  const rows = Array.isArray(citations) ? citations : Array.isArray(citations.citations) ? citations.citations : [];
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const url = r.url || r.page || r.href;
    const ms = tsMs(r.ts || r.firstSeen || r.at || r.date || r.capturedAt || r.ranAt);
    if (!url || ms === null) continue;
    out.push({ path: normPath(url), ms, url });
  }
  return out;
}

/**
 * Build the per-crawler × per-page matrix from parsed log entries.
 *
 * @param {object[]} entries    normalized events from parseLogLines
 * @param {string[]} [sitePages]  the site's page universe (URLs or paths); enables
 *                                never-fetched (= retrieval-failure) math
 * @param {object} [opts]
 * @param {object|null} [opts.ranges]     aibot-ips ranges; null → everything unverified
 * @param {object|object[]|null} [opts.citations]  URL-level citations report
 *        (array of {url, ts} or {citations:[...]}) → crawl→citation lag
 * @returns {object} report body (totals, agents, matrix, neverFetched, lag, …)
 */
export function aggregate(entries, sitePages = [], { ranges = null, citations = null } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const rangesAvailable = !!(ranges && Object.values(ranges).some((r) => r?.cidrs?.length));
  const totals = { entries: list.length, aiHits: 0, verified: 0, unverified: 0, spoofed: 0, userFetch: 0, other: 0 };
  const agents = {};  // agent → { kind, hits, verified, unverified, spoofed, lastSeen, pages:Set }
  const matrix = {};  // path → agent → { hits, verified, unverified, spoofed, class-tallied, lastSeen }
  // path → earliest VERIFIED AI fetch (ms). Never-fetched + crawl→citation lag are computed
  // from VERIFIED hits ONLY: spoofed hits are forged by definition, and 'unverified' hits are
  // exactly the ones we cannot distinguish from spoofing — precisely when the vendor-IP fetch
  // fails, spoofing is undetectable, so unverifiable claims must never clear a page off
  // never-fetched or anchor lag math (fail-closed).
  const firstFetchMs = new Map();

  for (const ev of list) {
    const c = classifyAgent(ev.ua, ev.ip, ranges);
    if (!c.agent) { totals.other++; continue; }
    totals.aiHits++;
    if (c.class === 'spoofed') totals.spoofed++;
    else if (c.class === 'user-fetch') totals.userFetch++;
    else if (c.verification === 'verified') totals.verified++;
    else totals.unverified++;

    const a = agents[c.agent] || (agents[c.agent] = { kind: c.kind, hits: 0, verified: 0, unverified: 0, spoofed: 0, lastSeen: null, pages: new Set() });
    a.hits++;
    if (c.verification === 'verified') a.verified++;
    else if (c.verification === 'spoofed') a.spoofed++;
    else a.unverified++;
    const ms = tsMs(ev.ts);
    if (ms !== null && (!a.lastSeen || ms > Date.parse(a.lastSeen))) a.lastSeen = new Date(ms).toISOString();

    const path = normPath(ev.path);
    const row = matrix[path] || (matrix[path] = {});
    const cell = row[c.agent] || (row[c.agent] = { hits: 0, verified: 0, unverified: 0, spoofed: 0, lastSeen: null });
    cell.hits++;
    if (c.verification === 'verified') cell.verified++;
    else if (c.verification === 'spoofed') cell.spoofed++;
    else cell.unverified++;
    if (ms !== null && (!cell.lastSeen || ms > Date.parse(cell.lastSeen))) cell.lastSeen = new Date(ms).toISOString();

    // Spoofed traffic must NEVER mark a page as AI-fetched (fail-closed); the per-agent
    // pages tally still counts non-spoofed hits (the verified/unverified columns say how
    // trustworthy they are), but ONLY VERIFIED hits feed never-fetched / lag math.
    if (c.verification !== 'spoofed') a.pages.add(path);
    if (c.verification === 'verified') {
      if (ms !== null) { const prev = firstFetchMs.get(path); if (prev === undefined || prev === null || ms < prev) firstFetchMs.set(path, ms); }
      else if (!firstFetchMs.has(path)) firstFetchMs.set(path, null); // fetched, time unknown
    }
  }

  for (const a of Object.values(agents)) a.pages = a.pages.size;

  // Never-fetched = sitePages with zero VERIFIED AI hits (retrieval failures). Computed
  // STRICT: when no vendor IP ranges are available this run, NOTHING verifies, so the whole
  // universe reads never-fetched — the caveat below says the section is not really
  // computable rather than letting unverifiable UA claims clear pages (fail-closed).
  const universe = (Array.isArray(sitePages) ? sitePages : []).map(normPath);
  const fetchedSet = new Set(firstFetchMs.keys());
  const neverFetched = [...new Set(universe)].filter((p) => !fetchedSet.has(p));
  const neverFetchedCaveat = rangesAvailable ? null
    : 'not computable this run — no vendor IP ranges, so no bot claim could be verified; computed STRICT (verified-only): unverified UA claims never clear a page off this list. Re-run once the vendor IP-range fetch succeeds.';

  // Crawl→citation lag: join URL-level citations on path; lag = citation − first VERIFIED crawl.
  let lag;
  const citRows = normalizeCitations(citations);
  if (!rangesAvailable) lag = { available: false, reason: 'not computable — no vendor IP ranges this run; lag joins only VERIFIED crawls, and unverifiable UA claims cannot anchor crawl→citation math (fail-closed)' };
  else if (!citations) lag = { available: false, reason: 'no citations report provided' };
  else if (!citRows.length) lag = { available: false, reason: 'citations report has no URL-level rows with timestamps (domain-only captures cannot join on URL)' };
  else {
    const pairs = [];
    for (const cit of citRows) {
      const crawlMs = firstFetchMs.get(cit.path);
      if (crawlMs === undefined || crawlMs === null) continue; // never (verifiably) crawled or crawl time unknown
      const lagDays = (cit.ms - crawlMs) / 86400000;
      if (lagDays < 0) continue; // citation precedes any observed crawl — outside this log window
      pairs.push({ path: cit.path, crawledAt: new Date(crawlMs).toISOString(), citedAt: new Date(cit.ms).toISOString(), lagDays: Math.round(lagDays * 100) / 100 });
    }
    lag = pairs.length
      ? { available: true, joined: pairs.length, medianLagDays: Math.round(median(pairs.map((p) => p.lagDays)) * 100) / 100, pairs: pairs.slice(0, 50) }
      : { available: false, reason: 'no citation row joined a crawled URL in this log window' };
  }

  return {
    totals,
    rangesAvailable,
    agents,
    matrix,
    fetchedPages: fetchedSet.size,
    sitePages: universe.length,
    neverFetched,
    neverFetchedCaveat,
    lag,
    insufficientData: list.length === 0,
  };
}

// --- report writer + CLI runner ------------------------------------------------------

function renderMd(cfg, r) {
  const L = [`# Agent analytics — ${cfg.brand || cfg.name}`, `${cfg.baseUrl || ''} · ${new Date(r.ranAt).toUTCString()} · from the server logs the client already owns`, ''];
  L.push(`> Which AI agents actually read this site — CIDR-verified, spoof-excluded. (Profound "Agent Analytics", free.)`, '');
  const t = r.totals;
  L.push(`- **Log lines parsed:** ${r.parse.readCount} (${r.parse.skippedCount} malformed lines skipped — counted, not hidden)`);
  L.push(`- **AI-agent hits:** ${t.aiHits} of ${t.entries} events — ✅ ${t.verified} verified · ❔ ${t.unverified} unverified (no IP ranges) · 🧑 ${t.userFetch} human-triggered · 🚫 ${t.spoofed} SPOOFED (excluded from all fetch counts)`);
  if (!r.rangesAvailable) L.push(`- ⚠ No vendor IP ranges available this run — nothing could be verified; all bot claims are reported as *unverified*, never as verified.`);
  L.push('');

  const agentNames = Object.keys(r.agents).sort((a, b) => r.agents[b].hits - r.agents[a].hits);
  if (agentNames.length) {
    L.push('## Per-agent summary', '', '| Agent | Kind | Hits | Verified | Unverified | Spoofed | Pages | Last seen |', '|---|---|---:|---:|---:|---:|---:|---|');
    for (const n of agentNames) {
      const a = r.agents[n];
      L.push(`| ${n} | ${a.kind} | ${a.hits} | ${a.verified} | ${a.unverified} | ${a.spoofed} | ${a.pages} | ${a.lastSeen ? a.lastSeen.slice(0, 16) : '—'} |`);
    }
    L.push('');
  } else L.push('## Per-agent summary', '', '_No AI-agent hits found in this log._', '');

  const paths = Object.keys(r.matrix).sort((a, b) => {
    const s = (p) => Object.values(r.matrix[p]).reduce((x, c) => x + c.hits, 0);
    return s(b) - s(a);
  }).slice(0, 40);
  if (paths.length && agentNames.length) {
    L.push('## Crawl matrix (per-page × per-agent, `verified/total` hits)', '', `| Page | ${agentNames.join(' | ')} |`, `|---|${agentNames.map(() => '---:').join('|')}|`);
    for (const p of paths) {
      const cells = agentNames.map((n) => { const c = r.matrix[p][n]; return c ? `${c.verified}/${c.hits}${c.spoofed ? ` (🚫${c.spoofed})` : ''}` : '·'; });
      L.push(`| ${p} | ${cells.join(' | ')} |`);
    }
    L.push('');
  }

  L.push('## Never fetched by any AI agent — retrieval failures', '');
  if (r.neverFetchedCaveat) L.push(`⚠ **${r.neverFetchedCaveat}**`, '');
  if (!r.sitePages) L.push('_No site-page universe available (sitemap discovery failed or none passed) — never-fetched math skipped._');
  else if (!r.neverFetched.length) L.push(`_All ${r.sitePages} known pages have at least one VERIFIED AI fetch._`);
  else {
    L.push(`${r.neverFetched.length} of ${r.sitePages} pages have ZERO verified AI fetches (fix discovery: internal links, sitemap, robots, IndexNow):`, '');
    r.neverFetched.slice(0, 50).forEach((p) => L.push(`- [ ] ${p}`));
  }
  L.push('', '## Crawl → citation lag', '');
  if (r.lag.available) {
    L.push(`Median **${r.lag.medianLagDays} days** from first VERIFIED crawl to citation (${r.lag.joined} URL joins).`, '');
    r.lag.pairs.slice(0, 15).forEach((p) => L.push(`- ${p.path} — crawled ${p.crawledAt.slice(0, 10)}, cited ${p.citedAt.slice(0, 10)} (${p.lagDays}d)`));
  } else L.push(`_Not computed: ${r.lag.reason}._`);
  L.push('');
  return L.join('\n');
}

/**
 * CLI runner: parse a log for a client → reports/<client>/agent-analytics.{json,md}.
 * FAILS CLOSED (no report written) when the log is empty or nothing parses.
 *
 * @param {object} cfg   client config
 * @param {object} opts
 * @param {string} [opts.source]     log file path (--log); defaults to cfg.logs.file,
 *                                   then the rolling access-events store from ingestLogs
 * @param {string} [opts.text]       raw log text (tests / pipes) — bypasses file reads
 * @param {'auto'|'combined'|'json'} [opts.format]
 * @param {object|null} [opts.ranges]   pre-fetched aibot-ips ranges
 * @param {boolean} [opts.fetchRanges=true]
 * @param {string[]|null} [opts.sitePages]  page universe; default: sitemap discovery
 * @param {object|null} [opts.citations]    citations report for lag join
 * @param {(s:string)=>void} [opts.log]
 */
export async function agentAnalytics(cfg, { source, text, format = 'auto', ranges = null, fetchRanges = true, sitePages = null, citations = null, log = () => {} } = {}) {
  log(`Agent analytics · ${cfg.brand || cfg.name} …`);

  // 1) Acquire log lines.
  let parsed;
  if (typeof text === 'string') {
    parsed = parseLogLines(text, { format });
  } else {
    const src = source || cfg.logs?.file;
    if (src) {
      if (!existsSync(src)) { const error = `agent-analytics: log file not found: ${src}`; log(`  ✖ ${error}`); return { ok: false, error }; }
      parsed = parseLogLines(readFileSync(src, 'utf-8'), { format });
    } else if (existsSync(eventsStorePath(cfg.name))) {
      // Rolling store rows are already-normalized events (ingestLogs) — no re-parse, but
      // rows lacking a path AND corrupt/unparseable store lines (counts.dropped from
      // readEvents) are SKIPPED AND COUNTED (never silently dropped).
      const counts = { dropped: 0 };
      const events = await loadEvents(cfg.name, { counts });
      const entries = events.filter((e) => e && e.path);
      parsed = { entries, skippedCount: (events.length - entries.length) + counts.dropped, readCount: events.length + counts.dropped, format: 'store' };
    } else {
      const error = 'agent-analytics: no log source — pass --log <file>, set cfg.logs.file, or run `crawlbudget`/ingestLogs first';
      log(`  ✖ ${error}`);
      return { ok: false, error };
    }
  }

  // 2) Empty log FAILS CLOSED — an absent log must never read as "no AI traffic".
  if (!parsed.entries.length) {
    const error = parsed.readCount === 0
      ? 'agent-analytics: empty log — no lines to analyze (fail-closed: this is NOT evidence of zero AI traffic)'
      : `agent-analytics: nothing parseable — ${parsed.readCount} lines read, ${parsed.skippedCount} malformed/skipped (fail-closed: cannot report on unparseable data)`;
    log(`  ✖ ${error}`);
    return { ok: false, error, skippedCount: parsed.skippedCount, readCount: parsed.readCount };
  }

  // 3) Vendor IP ranges (verification). Fetch failure → null → everything 'unverified'.
  if (!ranges && fetchRanges) { try { ranges = await fetchBotRanges({ log: () => {} }); } catch { ranges = null; } }

  // 4) Site-page universe for never-fetched math (sitemap; failure → skip that section).
  if (!Array.isArray(sitePages)) {
    try { const { discoverUrls } = await import('./crawl.mjs'); const { urls = [] } = await discoverUrls(cfg); sitePages = urls; }
    catch { sitePages = []; }
  }

  const body = aggregate(parsed.entries, sitePages, { ranges, citations });
  const report = { client: cfg.name, brand: cfg.brand, baseUrl: cfg.baseUrl, ranAt: nowIso(), parse: { readCount: parsed.readCount, skippedCount: parsed.skippedCount, format: parsed.format }, ...body };

  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const jsonPath = join(dir, 'agent-analytics.json');
  const mdPath = join(dir, 'agent-analytics.md');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderMd(cfg, report));

  const t = report.totals;
  log(`  ${t.aiHits} AI-agent hits (${t.verified} verified · ${t.unverified} unverified · ${t.userFetch} user-fetch · ${t.spoofed} SPOOFED-excluded) · ${report.parse.skippedCount} malformed lines skipped`);
  log(`  never-fetched ${report.neverFetched.length}/${report.sitePages} pages · lag ${report.lag.available ? report.lag.medianLagDays + 'd median' : 'n/a (' + report.lag.reason + ')'}`);
  log(`  → ${mdPath}`);
  return { ok: true, report, jsonPath, mdPath };
}
