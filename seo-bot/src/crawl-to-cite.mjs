// seo-bot · crawl-to-cite — closes the loop OTTO structurally cannot. It joins, per
// money URL: (a) whether a VERIFIED AI crawler (GPTBot / OAI-SearchBot / PerplexityBot
// / ClaudeBot) actually fetched it — from our own access logs — against (b) whether the
// page's domain appears in the AI-visibility CITATION set (the measure.mjs / sources
// capture). Every money URL falls into one of three diagnoses:
//   • cited                    — crawled AND cited → working; protect it.
//   • crawled-but-never-cited  — the bot read it but never cites it → PASSAGE problem
//                                (citability / answer-capsule / schema work).
//   • never-crawled            — the bot never fetched it → INDEXATION problem
//                                (internal links / sitemap / robots / IndexNow).
// This separates "they can't find it" from "they found it but it isn't quotable" —
// the single most actionable AEO distinction, and one a SaaS overlay with no server
// logs can never compute. Output: reports/<client>/crawl-to-cite.{json,md}.  No new deps.

import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso, hostOf } from './util.mjs';
import { readEvents } from './connect/logs.mjs';
import { discoverUrls } from './crawl.mjs';
import { fetchBotRanges, verifyBot } from './connect/aibot-ips.mjs';

const norm = (u) => (u || '').split('#')[0].replace(/\/$/, '');
// "money" pages = the pages worth citing. Mirrors links.mjs MONEY_RE but tolerant.
const MONEY_RE = /\/(treatment|service|services|treatments|med-spa|medspa|cost|price|best|guide|locations?|reviews?|[a-z-]+-[a-z]{2})\b/i;
// The AI crawlers whose hits we join to citations (must match aibot-ips SOURCES keys).
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'PerplexityBot', 'ClaudeBot'];
const AI_BOT_RE = /(GPTBot|OAI-SearchBot|PerplexityBot|ClaudeBot|ChatGPT-User|Claude-User|Perplexity-User)/i;

/** Read the most recent AI-visibility capture (same lookup as sources/index.mjs). */
function readLatestVisibility(client) {
  const dirs = [join(ROOT, 'seo-bot', 'reports', client, 'ai-visibility'), join(ROOT, 'data', 'ai-visibility')];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    const files = readdirSync(d).filter((f) => f.endsWith('.json')).sort();
    if (files.length) { try { return JSON.parse(readFileSync(join(d, files[files.length - 1]), 'utf-8')); } catch { /* */ } }
  }
  return null;
}

/** Did the engines cite the client's OWN domain anywhere in the capture?
 *  citedDomains are hostnames (no path), so the join is at domain granularity:
 *  if our domain is cited at all, every crawled money URL is a candidate citation. */
function citationSignal(cfg, vis) {
  const out = { ownCited: false, citingPrompts: [], engines: new Set(), capturedAt: vis?.ranAt || null, answers: 0 };
  if (!vis?.results?.length) return out;
  const own = (cfg.domain || '').replace(/^www\./, '');
  for (const r of vis.results) {
    if (r.error) continue;
    out.answers++;
    const cites = (r.citedDomains || []).map((d) => d.replace(/^www\./, ''));
    if (cites.some((d) => d.includes(own))) { out.ownCited = true; out.citingPrompts.push(r.prompt); out.engines.add(r.engine); }
  }
  out.engines = [...out.engines];
  return out;
}

/**
 * Classify every money URL crawled-vs-cited.
 *
 * @param {object} cfg
 * @param {object} opts
 * @param {(s:string)=>void} [opts.log]
 * @param {object} [opts.ranges]  pre-fetched aibot-ips ranges (else fetched once)
 * @param {boolean} [opts.fetchRanges=true]
 * @returns {Promise<object>} the crawl-to-cite report (also written to disk)
 */
export async function crawlToCite(cfg, { log = () => {}, ranges = null, fetchRanges = true } = {}) {
  log(`Crawl-to-cite · ${cfg.brand} …`);

  // 1) Money URL universe from the sitemap.
  const { urls: sitemapUrls = [] } = await discoverUrls(cfg).catch(() => ({ urls: [] }));
  const moneyUrls = new Set(sitemapUrls.map(norm).filter((u) => MONEY_RE.test(u)));
  // homepage is always money-relevant for brand citations
  moneyUrls.add(norm(cfg.baseUrl));

  // 2) Verified-bot ranges.
  if (fetchRanges && !ranges) { try { ranges = await fetchBotRanges({ log: () => {} }); } catch { ranges = null; } }

  // 3) Stream logs → per-URL per-bot VERIFIED hit counts.
  const perUrl = new Map(); // url -> { bots:{bot:{hits,verified,lastSeen}} }
  let aiBotHits = 0, aiVerified = 0, aiSpoofed = 0;

  for await (const ev of readEvents(cfg.name)) {
    const ua = ev.ua || '';
    if (!AI_BOT_RE.test(ua)) continue;
    aiBotHits++;
    const m = ua.match(AI_BOT_RE);
    // Normalize a -User suffix to its crawler family for range lookup where sensible.
    let bot = m[0];
    if (/^ChatGPT-User$/i.test(bot)) bot = 'ChatGPT-User';
    const path = (ev.path || '').split('?')[0];
    if (!path) continue;
    const url = norm(`${cfg.baseUrl}${path.startsWith('/') ? path : '/' + path}`);

    // Verification (CIDR can't be spoofed; UA can). Only the four crawler bots have ranges.
    let verified = null;
    if (AI_BOTS.includes(bot) && ranges?.[bot]?.cidrs) {
      verified = verifyBot(ev.ip, bot, ranges).verified;
      verified ? aiVerified++ : aiSpoofed++;
    }
    const rec = perUrl.get(url) || { url, bots: {} };
    const b = rec.bots[bot] || { hits: 0, verified: 0, lastSeen: null };
    b.hits++; if (verified === true) b.verified++; b.lastSeen = ev.ts;
    rec.bots[bot] = b; perUrl.set(url, rec);
  }

  // 4) Citation signal from the AI-visibility capture.
  const vis = readLatestVisibility(cfg.name);
  const cite = citationSignal(cfg, vis);

  // 5) Classify each money URL.
  const classify = (url) => {
    const rec = perUrl.get(url);
    const verifiedHits = rec ? Object.values(rec.bots).reduce((s, b) => s + (b.verified || (ranges ? 0 : b.hits)), 0) : 0;
    const anyHits = rec ? Object.values(rec.bots).reduce((s, b) => s + b.hits, 0) : 0;
    const crawled = verifiedHits > 0 || anyHits > 0;
    if (!crawled) return { url, status: 'never-crawled', diagnosis: 'indexation', aiHits: 0, bots: {} };
    // crawled. cited? — domain-level signal (citedDomains carry no path).
    if (cite.ownCited) return { url, status: 'cited', diagnosis: 'working', aiHits: anyHits, bots: rec.bots };
    return { url, status: 'crawled-but-never-cited', diagnosis: 'passage', aiHits: anyHits, bots: rec.bots };
  };

  const classified = [...moneyUrls].map(classify);
  const byStatus = { cited: [], 'crawled-but-never-cited': [], 'never-crawled': [] };
  for (const c of classified) byStatus[c.status].push(c);

  // Also surface AI-crawled URLs that aren't in our money set (bot interest we're not capitalizing on).
  const crawledNonMoney = [...perUrl.keys()].filter((u) => !moneyUrls.has(u)).slice(0, 50);

  const report = {
    client: cfg.name, brand: cfg.brand, baseUrl: cfg.baseUrl, ranAt: nowIso(),
    citation: { ownCited: cite.ownCited, capturedAt: cite.capturedAt, answers: cite.answers, engines: cite.engines, citingPrompts: cite.citingPrompts.slice(0, 10), note: vis ? null : 'no AI-visibility capture found — run `measure` first; until then cited% is unknown' },
    aiBots: { totalHits: aiBotHits, verified: aiVerified, spoofed: aiSpoofed, rangesAvailable: AI_BOTS.some((b) => ranges?.[b]?.cidrs) },
    counts: {
      money: moneyUrls.size,
      cited: byStatus.cited.length,
      crawledNeverCited: byStatus['crawled-but-never-cited'].length,
      neverCrawled: byStatus['never-crawled'].length,
    },
    cited: byStatus.cited.slice(0, 100),
    crawledButNeverCited: byStatus['crawled-but-never-cited'].slice(0, 100),
    neverCrawled: byStatus['never-crawled'].slice(0, 200),
    crawledNonMoney,
  };

  writeReport(cfg, report);
  log(`  money URLs ${report.counts.money} · cited ${report.counts.cited} · crawled-never-cited ${report.counts.crawledNeverCited} (passage) · never-crawled ${report.counts.neverCrawled} (indexation)`);
  log(`  AI-crawler hits ${aiBotHits} (${aiVerified} verified${aiSpoofed ? `, ${aiSpoofed} SPOOFED` : ''})${cite.ownCited ? ' · domain IS cited' : (vis ? ' · domain NOT cited' : ' · citation unknown (no capture)')}`);
  return report;
}

function writeReport(cfg, r) {
  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'crawl-to-cite.json'), JSON.stringify(r, null, 2));

  const L = [`# Crawl-to-cite — ${r.brand}`, `${r.baseUrl} · ${new Date(r.ranAt).toUTCString()} · joins our logs × AI citations`, ''];
  L.push(`> The loop OTTO can't close: which money pages did AI crawlers fetch, and of those, which actually get cited.`, '');
  L.push(`- **Money URLs:** ${r.counts.money}`);
  L.push(`- **Cited** (crawled + cited — protect): ${r.counts.cited}`);
  L.push(`- **Crawled but never cited** (PASSAGE problem — fix citability): ${r.counts.crawledNeverCited}`);
  L.push(`- **Never crawled** (INDEXATION problem — fix discovery): ${r.counts.neverCrawled}`);
  L.push(`- **AI-crawler hits:** ${r.aiBots.totalHits} (${r.aiBots.verified} verified${r.aiBots.spoofed ? `, ${r.aiBots.spoofed} SPOOFED` : ''})`);
  if (r.citation.note) L.push(`- ⚠ ${r.citation.note}`);
  if (r.crawledButNeverCited.length) {
    L.push('', '## Crawled but never cited — passage/citability work', '');
    L.push('These pages AI crawlers READ but don\'t cite: add answer capsules (≤17-word claims), question H2s, schema, fresh dates.', '');
    r.crawledButNeverCited.slice(0, 30).forEach((c) => L.push(`- [ ] ${c.url}  (${c.aiHits} AI hits: ${Object.keys(c.bots).join(', ')})`));
  }
  if (r.neverCrawled.length) {
    L.push('', '## Never crawled — indexation/discovery work', '');
    L.push('AI crawlers never fetched these money pages: add internal links from hubs, ensure in sitemap, IndexNow ping, check robots.', '');
    r.neverCrawled.slice(0, 30).forEach((c) => L.push(`- [ ] ${c.url}`));
  }
  if (r.cited.length) { L.push('', '## Cited (working — protect)', ''); r.cited.slice(0, 20).forEach((c) => L.push(`- ${c.url}`)); }
  if (r.crawledNonMoney.length) { L.push('', '## AI-crawled URLs outside the money set (latent interest)', ''); r.crawledNonMoney.slice(0, 20).forEach((u) => L.push(`- ${u}`)); }
  writeFileSync(join(dir, 'crawl-to-cite.md'), L.join('\n'));
}
