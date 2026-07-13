// seo-bot · content/blog-corpus — the COMPETITOR BLOG KNOWLEDGE BASE the operator asked for:
// "go through every single website ranking #1 for really competitive keywords in their cities,
// get and reverse-engineer ALL their blogs, learn the voice, keep it as training data."
//
// WHO is winning comes from data we already own — the query-bank panel + fanout-atlas (who
// ChatGPT ranks per city, by NAME) and their citations — so discovery costs ZERO risky SERP
// scrapes. The ranked names are resolved to their real websites by candidate-domain guessing
// (+ optional LLM fallback), ALWAYS verified against the fetched homepage (brand tokens + a
// med-spa signal) so a wrong or parked domain can never enter the corpus. Harvesting is
// sitemap-first (ALL posts, not a sampled few), with a paginated blog-index fallback, via a
// plain polite fetch (own UA, sequential, delayed, capped). blog-radar/journey mine this corpus
// for outlines, gaps, and difficulty; voice.mjs distills the winners' REGISTER into a quant
// profile + exemplars that drafting refers back to — we reverse-engineer, we NEVER copy (the
// near-dup gate in blog-publish enforces that at publish time).

import { extractBlogStructure } from './blog-radar.mjs';
import { buildVoiceArtifacts } from './voice.mjs';

// Non-clinic hosts: platforms, press, directories, map tiles — never "a winning med spa's site".
// (exported: serp-radar classifies Google results with the same list)
export const AGGREGATORS = /(^|\.)(yelp|reddit|instagram|facebook|linkedin|tiktok|youtube|google|groupon|realself|tripadvisor|nextdoor|threads|x|twitter|medium|wikipedia|mapbox|openstreetmap|apple|bing|allure|vogue|glamour|byrdie|cosmopolitan|elle|harpersbazaar|nymag|timeout|thecut|refinery29|newbeauty|threebestrated|expertise|birdeye|scoredoc|medspascout|spalens|beautyplaces|medicalspalocator|discovermedspa|zocdoc|healthgrades|vagaro|booksy|opentable|timesunion)\.(com|org|net)$/i;
const host = (u = '') => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/** PURE: rank the most-cited non-clinic-excluded domains out of observation citations —
 *  the SOURCES engines pull from (press/directories clinics appear in live here too). */
export function winningSpasFromPanel(observations = [], { max = 25 } = {}) {
  const acc = new Map();
  for (const o of observations || []) {
    if (!o || o.status !== 'ok') continue;
    for (const u of (o.citations?.urls || [])) {
      const h = host(u);
      if (!h || AGGREGATORS.test(h)) continue;
      const r = acc.get(h) || { domain: h, cites: 0, cities: new Set() };
      r.cites++; r.cities.add(o.city || '?'); acc.set(h, r);
    }
  }
  return [...acc.values()]
    .map((r) => ({ domain: r.domain, cites: r.cites, cityCount: r.cities.size, cities: [...r.cities] }))
    .sort((a, b) => b.cites - a.cites || b.cityCount - a.cityCount)
    .slice(0, max);
}

// ---- RANKED-CLINIC discovery (the actual #1s, by name) ---------------------------------------

const NAME_STOP = new Set(['the', 'a', 'of', 'by', 'at', 'in', 'and', '&', '-', '·']);
const NAME_GENERIC = new Set(['med', 'spa', 'medspa', 'medical', 'aesthetics', 'aesthetic', 'wellness', 'studio', 'clinic', 'center', 'centre', 'institute', 'laser', 'skin', 'skincare', 'beauty', 'dermatology', 'nyc', 'la']);
const cleanName = (n = '') => String(n)
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')     // strip diacritics
  .replace(/\s*[-–—|]\s*[^-–—|]{0,30}$/, '')             // strip trailing "- NYC" style location tags
  .replace(/[^\w\s&/']/g, ' ').replace(/\s+/g, ' ').trim();
const nameTokens = (n = '') => cleanName(n).toLowerCase().replace(/&/g, ' and ').replace(/[/']/g, '').split(/\s+/).filter((t) => t && !NAME_STOP.has(t));
const nameKey = (n = '') => nameTokens(n).join(' ');

/** PURE: mine the ranked[] clinic NAMES out of panel + atlas observations, rank-weighted
 *  (rank 1 = 1.0, rank 2 = 0.5, …). Location-suffix variants of the same brand merge by
 *  token-prefix. These are the actual med spas WINNING each city — the corpus targets. */
export function rankedClinicsFromPanel(observations = [], { max = 40 } = {}) {
  const acc = new Map();
  for (const o of observations || []) {
    if (!o || o.status !== 'ok') continue;
    for (const r of (o.ranked || [])) {
      const key = nameKey(r.name || '');
      if (key.length < 3) continue;
      const rec = acc.get(key) || { name: cleanName(r.name), key, score: 0, appearances: 0, bestRank: Infinity, cities: new Set() };
      rec.score += 1 / Math.max(1, Number(r.rank) || 99);
      rec.appearances++;
      rec.bestRank = Math.min(rec.bestRank, Number(r.rank) || 99);
      rec.cities.add(o.city || '?');
      acc.set(key, rec);
    }
  }
  // Merge "Brand Neighborhood" variants: strict token-prefix ("Ever/Body" + "Ever/Body Flatiron"),
  // OR a shared DISTINCTIVE brand head where both tails are location-like (non-generic) — that
  // unifies "Ever/Body Flatiron" + "Ever/Body Greenwich Village" while keeping "Tribeca MedSpa"
  // and "Tribeca Skin Center" (generic tails = different businesses) apart.
  const tailNonGeneric = (key) => { const t = key.split(' ').slice(1); return t.length > 0 && t.some((x) => !NAME_GENERIC.has(x)); };
  const recs = [...acc.values()].sort((a, b) => a.key.length - b.key.length);
  const kept = [];
  for (const r of recs) {
    const parent = kept.find((k) => {
      if (k.key.split(' ').length >= 2 && (r.key + ' ').startsWith(k.key + ' ')) return true;
      const head = k.key.split(' ')[0];
      return head === r.key.split(' ')[0] && head.length >= 6 && !NAME_GENERIC.has(head) && tailNonGeneric(k.key) && tailNonGeneric(r.key);
    });
    if (parent) {
      parent.score += r.score; parent.appearances += r.appearances;
      parent.bestRank = Math.min(parent.bestRank, r.bestRank);
      for (const c of r.cities) parent.cities.add(c);
    } else kept.push(r);
  }
  return kept
    .map((r) => ({ name: r.name, score: +r.score.toFixed(3), appearances: r.appearances, bestRank: r.bestRank, cities: [...r.cities], cityCount: r.cities.size }))
    .sort((a, b) => b.score - a.score || a.bestRank - b.bestRank)
    .slice(0, max);
}

/** PURE: candidate domains for a clinic name — the guesses that resolveClinicSite verifies. */
export function guessDomainsForName(name = '') {
  const toks = nameTokens(name);
  if (!toks.length) return [];
  const nonGeneric = toks.filter((t) => !NAME_GENERIC.has(t));
  const bases = new Set();
  bases.add(toks.join(''));
  if (nonGeneric.length) {
    bases.add(nonGeneric.join(''));
    bases.add(nonGeneric.join('') + 'medspa');
    bases.add(nonGeneric.join('') + 'md');
    bases.add(nonGeneric.join('-'));
  }
  // Bare distinctive head: "Ever/Body Greenwich Village" → everbody.com (neighborhood tokens
  // would otherwise pollute every guess). Verification still gates, so a generic head is safe.
  if (nonGeneric[0] && nonGeneric[0].length >= 6) { bases.add(nonGeneric[0]); bases.add(nonGeneric[0] + 'medspa'); }
  if (toks.length > 2) bases.add(toks.slice(0, 2).join(''));
  const out = [];
  // .com across EVERY base first (that's where spas live), then .co/.net as long shots.
  for (const tld of ['com', 'co', 'net']) {
    for (const b of bases) {
      const clean = b.replace(/[^a-z0-9-]/g, '');
      if (clean.length < 4 || clean.length > 40) continue;
      out.push(`${clean}.${tld}`);
    }
  }
  return [...new Set(out)].slice(0, 16);
}

const SPA_SIGNAL_RE = /\b(botox|filler|injectable|laser|facial|med\s?spa|medspa|medical spa|aesthetic|skin|dermatolog|coolsculpt|microneedl|hydrafacial|morpheus)\b/i;

/** PURE: does this fetched homepage actually belong to the named clinic? Brand tokens must
 *  appear in title/og/site text AND the page must read as a med-spa (kills parked/unrelated
 *  domains). Verification is what makes guessing + LLM fallback safe. */
export function verifyClinicSite(html = '', name = '') {
  const t = String(html || '');
  if (!t || t.length < 300) return { ok: false, reason: 'no-page' };
  const title = (t.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1] || '') + ' ' + (t.match(/property=["']og:site_name["'][^>]*content=["']([^"']{0,120})["']/i)?.[1] || '');
  const bodyStart = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').slice(0, 4000).toLowerCase();
  const hay = (title + ' ' + bodyStart).toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const distinctive = nameTokens(name).filter((x) => !NAME_GENERIC.has(x));
  const toks = distinctive.length ? distinctive : nameTokens(name);
  if (!toks.length) return { ok: false, reason: 'no-name-tokens' };
  const matched = toks.filter((x) => hay.includes(x)).length;
  const brandHit = matched >= Math.ceil(toks.length / 2) || hay.replace(/\s+/g, '').includes(toks.join(''));
  if (!brandHit) return { ok: false, reason: `brand-tokens ${matched}/${toks.length}` };
  if (!SPA_SIGNAL_RE.test(bodyStart)) return { ok: false, reason: 'no-medspa-signal' };
  return { ok: true, matched, of: toks.length };
}

/** Resolve a clinic name → its verified website. Guess-list first; optional LLM fallback
 *  (claude CLI knows many of these brands) — but EVERY answer is fetch-verified, so a wrong
 *  guess or an LLM hallucination can never enter the corpus. Returns null when unresolved. */
export async function resolveClinicSite(name, { city = '', fetchOne, llm = null, log = () => {} } = {}) {
  if (!fetchOne) throw new Error('resolveClinicSite needs fetchOne');
  for (const d of guessDomainsForName(name)) {
    const html = await fetchOne(`https://${d}`).catch(() => null);
    const v = verifyClinicSite(html, name);
    if (v.ok) return { domain: d, method: 'guess' };
  }
  if (llm) {
    try {
      const raw = await llm(`What is the official website domain of the med spa / aesthetic clinic named "${name}"${city ? ` in ${city}` : ''}? Reply with ONLY the bare domain (like example.com) or UNKNOWN.`, { maxTokens: 40, tag: 'clinic-domain' });
      const d = host(String(raw || '').trim().split(/\s+/).find((w) => w.includes('.')) || '');
      if (d && !AGGREGATORS.test(d)) {
        const html = await fetchOne(`https://${d}`).catch(() => null);
        const v = verifyClinicSite(html, name);
        if (v.ok) return { domain: d, method: 'llm' };
        log(`    ~ ${name}: LLM said ${d} but verification failed (${v.reason})`);
      }
    } catch { /* unresolved below */ }
  }
  return null;
}

// ---- Harvest (sitemap-first: ALL posts, not a sample) ----------------------------------------

const BLOG_PATH_RE = /\/(blog|articles?|resources|insights|news|posts?|journal|learn)\/[a-z0-9-]{6,}/i;
// Root-level article slugs (many spa sites publish posts at /): long multi-hyphen slugs only,
// so service pages like /laser-hair-removal never slip in.
const looksLikePostUrl = (u = '') => {
  if (BLOG_PATH_RE.test(u)) return true;
  try {
    const p = new URL(u).pathname.replace(/\/$/, '');
    const seg = p.split('/').filter(Boolean);
    const last = seg[seg.length - 1] || '';
    return seg.length <= 2 && (last.match(/-/g) || []).length >= 4 && last.length >= 24;
  } catch { return false; }
};

/** PURE: pull post URLs out of sitemap XML. trustAll = a posts-specific sitemap (every <loc> is a post). */
export function extractSitemapLinks(xml = '', domain = '', { trustAll = false, max = 500 } = {}) {
  const out = [];
  const seen = new Set();
  for (const m of String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const u = m[1].replace(/\/$/, '');
    if (host(u) !== host(domain)) continue;
    if (!trustAll && !looksLikePostUrl(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u); out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

/** PURE: same-host blog-post links from a blog index page's HTML (+ the rel-next page if any). */
export function extractPostLinks(html = '', baseUrl = '', { max = 200 } = {}) {
  const base = host(baseUrl);
  const out = [];
  const seen = new Set();
  for (const m of String(html).matchAll(/href=["']([^"'#?]+)["']/gi)) {
    let u = m[1];
    try { u = new URL(u, baseUrl).toString(); } catch { continue; }
    if (host(u) !== base) continue;
    if (!BLOG_PATH_RE.test(u)) continue;
    const clean = u.replace(/\/$/, '');
    if (seen.has(clean)) continue;
    seen.add(clean); out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

/** PURE: the next pagination URL from a blog index (rel=next, or a /page/N style link). */
export function nextIndexPage(html = '', currentUrl = '') {
  const rel = String(html).match(/<a[^>]+rel=["']next["'][^>]*href=["']([^"']+)["']|<link[^>]+rel=["']next["'][^>]*href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*rel=["']next["']/i);
  const cand = rel && (rel[1] || rel[2] || rel[3]);
  if (cand) { try { return new URL(cand, currentUrl).toString(); } catch { /* */ } }
  const m = String(html).match(/href=["']([^"']*\/page\/(\d+)\/?)["']/i);
  if (m) { try { const u = new URL(m[1], currentUrl).toString(); return u === currentUrl ? null : u; } catch { /* */ } }
  return null;
}

/** PURE: the POST's prose, not the page chrome. Voice/gap mining must never measure nav walls —
 *  whole-page text made sentence stats absurd (mean ~26w, sd ~33 — menus have no periods).
 *  Scope to <article>/<main> when present; otherwise strip header/nav/footer/aside/form. */
export function articleText(html = '') {
  const h = String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, ' ');
  const scope = h.match(/<article[^>]*>[\s\S]*?<\/article>/i)?.[0]
    || h.match(/<main[^>]*>[\s\S]*?<\/main>/i)?.[0]
    || h.replace(/<(header|nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  return scope.replace(/<[^>]+>/g, ' ')
    // Entities: named → char; numeric → space (entity digits must never read as "numbers").
    .replace(/&amp;/gi, '&').replace(/&nbsp;/gi, ' ').replace(/&#0?39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&#\d+;|&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

const BLOG_INDEX_PATHS = ['/blog', '/blog/', '/articles', '/resources', '/insights', '/news', '/journal'];
const SITEMAP_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/sitemap-posts.xml'];

/** Harvest one domain's blog. Sitemap-first (ALL posts), paginated index fallback.
 *  fetchOne(url) → html|null (injected: tests use fixtures; live uses a plain polite fetch). */
export async function harvestBlog(domain, { fetchOne, maxPosts = 40, maxIndexPages = 5, log = () => {} } = {}) {
  if (!fetchOne) throw new Error('harvestBlog needs fetchOne');
  const baseUrl = `https://${domain}`;
  let links = [];
  let via = null;

  // 1) Sitemap-first: a posts sitemap enumerates EVERYTHING, no pagination guesswork.
  for (const p of SITEMAP_PATHS) {
    const xml = await fetchOne(baseUrl + p).catch(() => null);
    if (!xml || !/<(urlset|sitemapindex)/i.test(String(xml))) continue;
    if (/<sitemapindex/i.test(String(xml))) {
      const children = [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
      const postish = children.filter((u) => /post|blog|article/i.test(u)).slice(0, 4);
      for (const c of (postish.length ? postish : children.slice(0, 4))) {
        const cx = await fetchOne(c).catch(() => null);
        if (cx) links.push(...extractSitemapLinks(cx, baseUrl, { trustAll: /post|blog|article/i.test(c) }));
      }
    } else {
      links.push(...extractSitemapLinks(xml, baseUrl, { trustAll: /post/i.test(p) }));
    }
    if (links.length) { via = `sitemap ${p}`; break; }
  }

  // 2) Fallback: blog index + pagination.
  let indexUrl = null;
  if (!links.length) {
    for (const p of BLOG_INDEX_PATHS) {
      const html = await fetchOne(baseUrl + p).catch(() => null);
      if (html && String(html).length > 500) {
        indexUrl = baseUrl + p;
        let pageHtml = html, pageUrl = indexUrl;
        const seenPages = new Set([pageUrl]);
        for (let i = 0; i < maxIndexPages && pageHtml; i++) {
          links.push(...extractPostLinks(pageHtml, pageUrl));
          const next = nextIndexPage(pageHtml, pageUrl);
          if (!next || seenPages.has(next)) break;
          seenPages.add(next);
          pageUrl = next;
          pageHtml = await fetchOne(next).catch(() => null);
        }
        if (links.length) { via = `index ${p}`; break; }
      }
    }
  }

  links = [...new Set(links)].slice(0, maxPosts);
  if (!links.length) return { domain, status: 'no-blog', posts: [] };

  const posts = [];
  for (const url of links) {
    const html = await fetchOne(url).catch(() => null);
    if (!html) continue;
    const s = extractBlogStructure(html, url);
    posts.push({ url, title: s.title || '', h1: s.h1 || '', headings: s.headings || [], questions: s.questions || [], wordCount: s.wordCount || 0, text: articleText(html).slice(0, 20000) });
  }
  return { domain, status: posts.length ? 'ok' : 'empty', via, indexUrl, discovered: links.length, posts };
}

/** PURE: mine the stored corpus into journey topic candidates — what winners write about that we
 *  haven't covered (difficulty scales with how MANY winners cover it: consensus topics = heads). */
export function corpusTopics(corpus = [], { ourTitles = [], max = 40 } = {}) {
  const ours = new Set(ourTitles.map((t) => String(t).toLowerCase()));
  const topicMap = new Map();
  for (const site of corpus) {
    for (const p of (site.posts || [])) {
      const t = (p.h1 || p.title || '').replace(/\s*[|–-]\s*[^|–-]{0,40}$/, '').trim();
      if (t.length < 12) continue;
      const k = t.toLowerCase();
      if ([...ours].some((o) => o.includes(k.slice(0, 30)) || k.includes(o.slice(0, 30)))) continue;
      const r = topicMap.get(k) || { topic: t, coveredBy: new Set(), demand: 0 };
      r.coveredBy.add(site.domain); r.demand += 1; topicMap.set(k, r);
    }
  }
  return [...topicMap.values()]
    .map((r) => ({ topic: r.topic, demand: r.demand, coveredBy: [...r.coveredBy], difficulty: +Math.min(0.95, 0.5 + r.coveredBy.size * 0.1).toFixed(2) }))
    .sort((a, b) => b.demand - a.demand)
    .slice(0, max);
}

/** Full run: ranked clinics (resolved + verified) AND cited sources → harvest ALL their posts →
 *  research/blog-corpus/<client>/ → distill the winners' voice profile + exemplars (training data). */
export async function runBlogCorpus(cfg = {}, { observations = [], atlas = [], fs, dir, fetchOne, llm = null, log = () => {}, maxSites = 20, maxCited = 6, maxPosts = 40, nowIso = new Date().toISOString() } = {}) {
  if (!fs || !dir) throw new Error('runBlogCorpus needs { fs, dir }');
  fs.mkdirSync(dir, { recursive: true });
  const all = [...(observations || []), ...(atlas || [])];

  // Lane 1 — the actual winners: ranked clinic names, resolved + verified.
  const clinics = rankedClinicsFromPanel(all, { max: maxSites });
  // Lane 2 — the sources engines cite (press/directories with real blogs of their own).
  const cited = winningSpasFromPanel(all, { max: maxCited });
  if (!clinics.length && !cited.length) { log('  blog-corpus: no winners in the panel yet — run query-bank/fanout-atlas first'); return { status: 'no-winners', harvested: 0 }; }

  const results = [];
  const unresolved = [];
  for (const c of clinics) {
    const site = await resolveClinicSite(c.name, { city: c.cities[0] || '', fetchOne, llm, log });
    if (!site) { unresolved.push(c); log(`  [corpus] ✗ ${c.name}: no verified site (guesses + LLM exhausted)`); continue; }
    const r = await harvestBlog(site.domain, { fetchOne, maxPosts, log });
    results.push({ ...r, kind: 'clinic', name: c.name, resolvedVia: site.method, score: c.score, bestRank: c.bestRank, cities: c.cities });
    if (r.posts.length) fs.writeFileSync(`${dir}/${site.domain.replace(/[^a-z0-9.-]/g, '_')}.json`, JSON.stringify({ harvestedAt: nowIso, kind: 'clinic', name: c.name, ...r }, null, 2));
    log(`  [corpus] ${c.name} → ${site.domain} (${site.method}): ${r.status}${r.via ? ` via ${r.via}` : ''} · ${r.posts.length} posts stored`);
  }
  for (const w of cited) {
    const r = await harvestBlog(w.domain, { fetchOne, maxPosts: Math.min(maxPosts, 15), log });
    results.push({ ...r, kind: 'cited-source', cites: w.cites, cities: w.cities });
    if (r.posts.length) fs.writeFileSync(`${dir}/${w.domain.replace(/[^a-z0-9.-]/g, '_')}.json`, JSON.stringify({ harvestedAt: nowIso, kind: 'cited-source', ...r }, null, 2));
    log(`  [corpus] ${w.domain} (cited source): ${r.status} · ${r.posts.length} posts stored`);
  }

  const ok = results.filter((r) => r.posts.length);
  // Voice: distill the CLINIC winners' register into the training-data profile drafting refers to.
  const clinicCorpus = ok.filter((r) => r.kind === 'clinic');
  const voice = clinicCorpus.length ? buildVoiceArtifacts(clinicCorpus, { fs, dir, cities: [...new Set(all.map((o) => o?.city).filter(Boolean))], nowIso }) : null;

  const index = [
    '# Competitor blog corpus — the winners\' content, stored as knowledge', '',
    `Harvested ${nowIso.slice(0, 10)} · ${ok.length}/${results.length} sites had a harvestable blog · winners = ranked clinics from the query-bank panel + fanout-atlas (resolved to verified sites), plus the sources engines cite.`, '',
    '## Ranked clinics (the actual #1s, city by city)',
    '| clinic | site | resolved | best rank | score | cities | posts | via |',
    '|--------|------|----------|-----------|-------|--------|-------|-----|',
    ...results.filter((r) => r.kind === 'clinic').map((r) => `| ${r.name} | ${r.domain} | ${r.resolvedVia} | #${r.bestRank} | ${r.score} | ${(r.cities || []).join('; ')} | ${r.posts.length} | ${r.via || '—'} |`),
    ...(unresolved.length ? ['', `_Unresolved (no verified site found): ${unresolved.map((u) => `${u.name} (#${u.bestRank}, ${u.cities.join('/')})`).join(' · ')}_`] : []),
    '', '## Cited sources (press/directories the engines pull from)',
    '| domain | AI cites | cities | posts | blog |',
    '|--------|----------|--------|-------|------|',
    ...results.filter((r) => r.kind === 'cited-source').map((r) => `| ${r.domain} | ${r.cites} | ${(r.cities || []).length} | ${r.posts.length} | ${r.via || r.indexUrl || '—'} |`),
    '',
    voice ? `**Voice profile:** ${voice.summary} → voice-profile.json + voice.md` : '_No clinic posts harvested yet — no voice profile built._',
    '', '_Reference only: blog-radar/journey mine outlines + gaps from these; voice.mjs distills the register; blog-publish\'s near-dup gate makes copying impossible._',
  ].join('\n');
  fs.writeFileSync(`${dir}/INDEX.md`, index);
  return { status: ok.length ? 'ok' : 'empty', harvested: ok.length, clinics: results.filter((r) => r.kind === 'clinic').length, unresolved: unresolved.length, domains: results.length, voice: voice ? voice.summary : null, dir };
}
