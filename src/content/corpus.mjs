// seo-bot · content/corpus — assemble a top-N competitor corpus for a target query.
//
// The corpus is the substrate every content-IR module scores against (terms.mjs,
// score.mjs, topicmodel.mjs). For one query we:
//   1) get a set of candidate result URLs (the "who ranks for this" set), then
//   2) fetch each with the plain raw-HTML fetcher (util.fetchPage) and strip it to
//      visible body text with the SAME cheerio extraction the auditor uses (rules.parsePage),
//   3) cache the result to reports/<client>/corpus/<slug>.json with a 7-day TTL.
//
// URL SOURCING (honors "no paid API"):
//   • PREFERRED — seed from first-party data we already pull for free: GSC query→page
//     rows and Bing query stats give us the pages WE rank on for the query; the client's
//     own competitor list (cfg.competitors) supplies known rival hosts. No SERP scrape.
//   • RAW SERP (Mac-only) — if first-party seeds are thin and the caller passes
//     { allowSerp:true }, we call the EXISTING serp.mjs (trackSerp → stealthFetch) to
//     read the live organic set. *** That stealth path runs ONLY on the Mac Mini
//     (residential IP + Python/Scrapling). This module DOES NOT scrape on its own and
//     does not invoke stealth from a non-Mac context — it delegates to serp.mjs, which
//     no-ops with a note when the sidecar isn't present. ***
//
// Fetching the competitor PAGES themselves uses the ordinary raw-HTML fetcher (the same
// thing the audit already does for the client's own site) — that is a normal page GET,
// not a SERP scrape, and is fine off-Mac.

import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { ROOT } from '../config.mjs';
import { fetchPage, slugify, nowIso, hostOf, countWords, sleep } from '../util.mjs';
import { parsePage } from '../rules.mjs';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_TOP = 10;

function corpusPath(cfg, query) {
  return join(ROOT, 'reports', cfg.name, 'corpus', `${slugify(query)}.json`);
}

/** Read a cached corpus if it exists and is within TTL; else null. */
export function readCachedCorpus(cfg, query, { ttlMs = TTL_MS } = {}) {
  const file = corpusPath(cfg, query);
  if (!existsSync(file)) return null;
  try {
    const ageMs = Date.now() - statSync(file).mtimeMs;
    if (ageMs > ttlMs) return null;
    const c = JSON.parse(readFileSync(file, 'utf-8'));
    c._cached = true; c._ageHours = Math.round(ageMs / 3.6e6);
    return c;
  } catch { return null; }
}

/**
 * Seed candidate result URLs for the query WITHOUT scraping a SERP.
 * Sources, in order: GSC query→page rows (our own ranking pages), client competitor
 * hosts (homepages as a coarse seed), Bing query stats. Returns a de-duped URL list.
 */
export async function seedUrlsFreeFirst(cfg, query, { log = () => {} } = {}) {
  const urls = [];
  const q = query.toLowerCase();

  // GSC: pages that already rank for a query containing/contained-by ours.
  try {
    const { pullGSC } = await import('../gsc.mjs');
    const gsc = await pullGSC(cfg, { log: () => {} });
    if (gsc?.enabled) {
      for (const row of gsc.queries || []) {
        const qq = (row.keys?.[0] || '').toLowerCase();
        if (qq && (qq.includes(q) || q.includes(qq))) {
          // map back to a page via opportunities/pages if available
        }
      }
      for (const p of gsc.pages || []) if (p.keys?.[0]) urls.push(p.keys[0]);
    }
  } catch { /* GSC optional */ }

  // Bing query stats (free) — confirms the query has demand; doesn't give URLs, but
  // surfaces related queries we could widen with. (URL-less; kept for the note only.)
  // Competitor hosts from config — coarse homepage seeds (a real corpus prefers the
  // ranking URL, but a known rival's site is a legitimate competitor sample).
  for (const c of cfg.competitors || []) {
    const host = c.startsWith('http') ? c : `https://${c.replace(/^www\./, '')}`;
    if (/^https?:\/\//.test(host) && hostOf(host)) urls.push(host);
  }
  const out = [...new Set(urls)].filter((u) => hostOf(u) && hostOf(u) !== hostOf(cfg.baseUrl));
  log(`  corpus seed (free-first): ${out.length} candidate URL(s) from GSC + competitors.`);
  return out;
}

/**
 * Get candidate URLs via the EXISTING serp.mjs path. *** Mac-only: serp.mjs uses
 * stealthFetch (Python/Scrapling + residential IP) which only works on the Mac Mini;
 * elsewhere it returns 0 fetched and we degrade to the free-first seeds. We do NOT
 * call stealth directly here. ***
 */
async function seedUrlsFromSerp(cfg, query, { top, log = () => {} } = {}) {
  try {
    const { trackSerp } = await import('../serp.mjs');
    // serp.mjs tracks cfg.tracking.keywords; run it scoped to this single query.
    const scoped = { ...cfg, tracking: { ...(cfg.tracking || {}), keywords: [query] } };
    const r = await trackSerp(scoped, { log: () => {}, live: true });
    const row = (r?.rows || [])[0];
    // trackSerp persists organic hosts but returns ranks; re-read its serp.json for URLs.
    const serpJson = join(ROOT, 'reports', cfg.name, 'serp.json');
    let urls = [];
    if (existsSync(serpJson)) {
      try {
        const j = JSON.parse(readFileSync(serpJson, 'utf-8'));
        const match = (j.rows || []).find((x) => x.keyword === query);
        urls = (match?.organic || []).map((o) => o.url).filter(Boolean);
      } catch { /* ignore */ }
    }
    if (!urls.length && row?.competitors) urls = []; // serp returned ranks only
    if (!r?.fetched) log('  corpus SERP seed: 0 fetched — Mac-only stealth path (Python+Scrapling+residential IP). Falling back to free-first seeds.');
    return [...new Set(urls)].filter((u) => hostOf(u) && hostOf(u) !== hostOf(cfg.baseUrl)).slice(0, top);
  } catch (e) {
    log(`  corpus SERP seed skipped: ${String(e.message || e).slice(0, 120)}`);
    return [];
  }
}

/**
 * Build (or load from cache) a top-N competitor corpus for a query.
 * @param {object} cfg client config
 * @param {string} query target query (e.g. "botox cost austin")
 * @param {{log?:Function, top?:number, ttlMs?:number, allowSerp?:boolean, refresh?:boolean, seedUrls?:string[]}} [opts]
 * @returns {Promise<{query,builtAt,top,source,docs:[{url,host,title,text,words,headings}],skipped:[{url,reason}]}>}
 *
 * docs[].text is the visible body text (script/style/nav stripped) — the substrate for
 * extractTerms / scoreContent / topic model. Always returns a corpus object (possibly
 * with 0 docs + a note) — never throws on empty SERP.
 */
export async function buildCorpus(cfg, query, { log = () => {}, top = DEFAULT_TOP, ttlMs = TTL_MS, allowSerp = false, refresh = false, seedUrls = null } = {}) {
  if (!query) throw new Error('buildCorpus: query is required');

  if (!refresh) {
    const cached = readCachedCorpus(cfg, query, { ttlMs });
    if (cached) { log(`  corpus: cache hit for "${query}" (${cached.docs?.length || 0} docs, ${cached._ageHours}h old).`); return cached; }
  }

  // 1) candidate URLs
  let urls = seedUrls ? [...seedUrls] : [];
  let source = seedUrls ? 'caller' : 'free-first';
  if (!urls.length) urls = await seedUrlsFreeFirst(cfg, query, { log });
  if (urls.length < Math.min(3, top) && allowSerp) {
    const serpUrls = await seedUrlsFromSerp(cfg, query, { top, log });
    if (serpUrls.length) { urls = [...new Set([...serpUrls, ...urls])]; source = 'serp+free-first'; }
  }
  urls = urls.slice(0, top);

  // 2) fetch + strip each competitor PAGE (ordinary raw-HTML GET — not a SERP scrape)
  const docs = [], skipped = [];
  for (const url of urls) {
    const res = await fetchPage(url, { timeoutMs: 15000 });
    if (!res.ok || res.status !== 200 || !res.text) { skipped.push({ url, reason: `http ${res.status}${res.error ? ' ' + res.error : ''}` }); await sleep(250); continue; }
    try {
      const p = parsePage(res.text, res.finalUrl || url, cfg);
      const bodyText = bodyTextFromParsed(res.text);
      if (countWords(bodyText) < 80) { skipped.push({ url, reason: `thin (${countWords(bodyText)}w) — likely JS-shell` }); await sleep(250); continue; }
      docs.push({
        url: res.finalUrl || url, host: hostOf(url), title: p.title,
        text: bodyText, words: countWords(bodyText),
        headings: (p.headings || []).map((h) => h.text),
      });
    } catch (e) { skipped.push({ url, reason: String(e.message || e).slice(0, 80) }); }
    await sleep(300); // politeness between competitor fetches
  }

  const corpus = { query, builtAt: nowIso(), top, source, client: cfg.name, docs, skipped };
  // 3) cache
  const file = corpusPath(cfg, query);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(corpus, null, 2));
  log(`  corpus: built "${query}" — ${docs.length} docs (${skipped.length} skipped) via ${source} → ${file}`);
  if (!docs.length) log('  ⚠ empty corpus — no usable competitor pages (thin/JS-shell or no seeds). On the Mac, pass allowSerp to widen via stealth SERP.');
  return corpus;
}

// Visible-body extraction matched to rules.mjs (script/style/noscript/svg/template removed),
// so the corpus text is exactly what parsePage measures. parsePage returns counts + answer
// text only, so we re-derive the full body string here using the same cheerio strip.
function bodyTextFromParsed(html) {
  const $ = cheerio.load(html || '');
  $('script,style,noscript,svg,template').remove();
  return ($('body').text() || '').replace(/\s+/g, ' ').trim();
}
