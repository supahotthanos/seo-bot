// seo-bot · measure/serp-radar — the GOOGLE lane of the operator's two-lane directive
// (2026-07-12): "search Google for 'best med spa in <city>' + the money variants; the spas in
// the top 10 — what page ranks, what blogs they have, what tactics they share; replicate per
// city." Distinct from the ChatGPT lane (fanout-atlas/query-bank): this measures ORGANIC SEO.
//
// Capture posture is the repo standard: real stealth browser (patchright → system channel),
// uule geo-pin per city so one IP can observe every market, block-aware (a consent wall /
// reCAPTCHA row is status:'blocked' and EXCLUDED — never a fake "nobody ranks"), paced with
// human delays, circuit-broken (2 consecutive blocks → halt), persistent .cooldown after any
// halt (same anti-re-hammer contract as query-bank), cursor-resumable. Volume stays modest:
// a handful of queries per city per run, accruing across runs.
//
// Analysis is pure + testable: recurrence-weighted winners (who ranks across MANY queries =
// who owns the city), the exact PAGES that rank (home vs service vs blog — "what blog is it
// pulling from"), and a deterministic tactic fingerprint of each ranking page (JSON-LD types,
// FAQ/review schema, word count, city-in-title, blog internal links). Winners feed the same
// blog-corpus + voice pipeline as the ChatGPT lane — two discovery engines, one knowledge base.

import { launchBrowser } from './browser.mjs';
import { humanDelayMs, inCooldown, SAFE_DEFAULTS } from './capture-governor.mjs';
import { AGGREGATORS, articleText } from '../content/blog-corpus.mjs';
import { sidecarFetch } from './scrapling.mjs';

const host = (u = '') => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);

// The money intents. {city} filled per market; "near me" rides the uule pin alone. Mirrors the
// ChatGPT query bank so both lanes cover the same demand surface (overall-best, per-service, price).
export const SERP_QUERY_TEMPLATES = [
  'best med spa in {city}',
  'best medical spa in {city}',
  'med spa near me',
  'best med spa for botox in {city}',
  'best place to get botox in {city}',
  'best med spa for fillers in {city}',
  'best laser hair removal in {city}',
  'best med spa for microneedling in {city}',
  'best coolsculpting in {city}',
  'medical weight loss clinic in {city}',
  'how much is botox in {city}',
  'top rated med spa in {city} reviews',
];

// Press/list sites that rank for these queries but aren't clinics (extends the corpus list).
// City magazines and lifestyle press rank constantly for "best med spa in <city>" — caught live:
// observer.com and modernluxury.com harvested as "clinics" and polluted the voice profile.
const SERP_PRESS = /(^|\.)(forbes|nytimes|usatoday|buzzfeed|cbsnews|nbcnews|abcnews|foxnews|patch|axios|businessinsider|clutch|superpages|yellowpages|angi|thumbtack|bbb|mapquest|groupon|observer|modernluxury|nypost|latimes|chicagomag|phillymag|bostonmagazine|dmagazine|houstoniamag|miaminewtimes|laweekly|villagevoice|papercitymag|culturemap|secretnyc|secretlosangeles|purewow|thezoereport|wwd|instyle|realsimple|goodhousekeeping|townandcountrymag|marieclaire)\./i;

export const classifySerpHost = (h = '') => (AGGREGATORS.test(h) || SERP_PRESS.test(h) ? 'directory-or-press' : 'clinic-candidate');

/** PURE: expand cities × templates into capture specs. */
export function buildSerpSpecs(cities = [], templates = SERP_QUERY_TEMPLATES) {
  const specs = [];
  for (const city of cities) for (const t of templates) {
    specs.push({ city, template: t, query: t.replace(/\{city\}/g, city), engine: 'google_organic' });
  }
  return specs.map((s, i) => ({ ...s, i }));
}

/** PURE: page-type of a ranking URL — the "what page do they rank WITH" dimension. */
export function pageTypeOf(u = '') {
  try {
    const p = new URL(u).pathname.replace(/\/$/, '').toLowerCase();
    if (!p || p === '') return 'home';
    if (/\/(blog|articles?|journal|news|resources|insights|learn|guides?)(\/|$)/.test(p)) return 'blog';
    if (/(botox|filler|lip|laser|facial|hydrafacial|morpheus|microneedl|coolsculpt|sculptra|prp|iv-|weight-loss|semaglutide|skin|peel|injectable|treatment|service)/.test(p)) return 'service';
    if (/(location|near-me|city|areas?-served|miami|chicago|houston|dallas|austin|scottsdale|新york)/.test(p)) return 'location';
    return 'other';
  } catch { return 'other'; }
}

/** PURE: recurrence-weighted winners across every stored SERP observation. Multi-query,
 *  multi-city recurrence is the ownership signal ("what ELSE do they rank for" within our
 *  query set); pages[] records the exact URLs Google chose — including which blogs. */
export function serpWinners(observations = [], { max = 40 } = {}) {
  const acc = new Map();
  for (const o of observations || []) {
    if (!o || o.status !== 'ok') continue;
    for (const r of (o.results || [])) {
      const h = host(r.url);
      if (!h) continue;
      const kind = classifySerpHost(h);
      const rec = acc.get(h) || { domain: h, kind, score: 0, bestRank: Infinity, queries: new Set(), cities: new Set(), pages: new Map() };
      rec.score += 1 / Math.max(1, Number(r.rank) || 99);
      rec.bestRank = Math.min(rec.bestRank, Number(r.rank) || 99);
      rec.queries.add(o.query); rec.cities.add(o.city || '?');
      const pu = String(r.url).replace(/[?#].*$/, '').replace(/\/$/, '') || r.url;
      const pg = rec.pages.get(pu) || { url: pu, pageType: pageTypeOf(pu), bestRank: Infinity, queries: new Set() };
      pg.bestRank = Math.min(pg.bestRank, Number(r.rank) || 99); pg.queries.add(o.query);
      rec.pages.set(pu, pg);
      acc.set(h, rec);
    }
  }
  return [...acc.values()]
    .map((r) => ({ domain: r.domain, kind: r.kind, score: +r.score.toFixed(3), bestRank: r.bestRank, queryCount: r.queries.size, queries: [...r.queries], cities: [...r.cities], cityCount: r.cities.size,
      pages: [...r.pages.values()].map((p) => ({ url: p.url, pageType: p.pageType, bestRank: p.bestRank, queries: [...p.queries] })).sort((a, b) => a.bestRank - b.bestRank) }))
    .sort((a, b) => b.score - a.score || a.bestRank - b.bestRank)
    .slice(0, max);
}

/** PURE: deterministic SEO-tactic fingerprint of one ranking page. */
export function tacticFingerprint(html = '', url = '', { city = '' } = {}) {
  const h = String(html || '');
  if (h.length < 300) return null;
  const types = [];
  for (const m of h.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const collect = (n) => { if (!n || typeof n !== 'object') return; if (n['@type']) types.push(...[].concat(n['@type'])); for (const k of ['@graph', 'mainEntity', 'itemListElement']) if (Array.isArray(n[k])) n[k].forEach(collect); };
      collect(JSON.parse(m[1]));
    } catch { /* malformed block — skip */ }
  }
  const title = h.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1]?.trim() || '';
  const h1 = h.match(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' ').trim() || '';
  const cityWord = String(city).split(/[ ,]/)[0] || null;
  const text = articleText(h);
  return {
    url, pageType: pageTypeOf(url),
    jsonLdTypes: [...new Set(types)],
    hasLocalBusiness: types.some((t) => /LocalBusiness|MedicalBusiness|MedicalClinic|HealthAndBeautyBusiness|MedSpa|DaySpa/i.test(t)),
    hasFaqSchema: types.some((t) => /FAQPage|Question/i.test(t)),
    hasAggregateRating: /"aggregateRating"/i.test(h),
    title, h1,
    titleHasCity: !!(cityWord && new RegExp(`\\b${cityWord}\\b`, 'i').test(title)),
    yearInTitle: /20\d\d/.test(title),
    wordCount: words(text).length,
    h2Count: (h.match(/<h2[\s>]/gi) || []).length,
    blogLinkCount: new Set([...h.matchAll(/href=["']([^"']*\/blog\/[^"']+)["']/gi)].map((m) => m[1])).size,
    phonePresent: /href=["']tel:|(\(\d{3}\)\s?\d{3}[-.\s]?\d{4})/.test(h),
  };
}

/** PURE: aggregate fingerprints into the "what the winners share" tactic table. */
export function tacticRollup(fps = []) {
  const rows = fps.filter(Boolean);
  if (!rows.length) return null;
  const pct = (f) => +(rows.filter(f).length / rows.length).toFixed(2);
  const wcs = rows.map((r) => r.wordCount).sort((a, b) => a - b);
  const byType = {};
  for (const r of rows) byType[r.pageType] = (byType[r.pageType] || 0) + 1;
  return {
    pages: rows.length,
    localBusinessSchema: pct((r) => r.hasLocalBusiness),
    faqSchema: pct((r) => r.hasFaqSchema),
    aggregateRating: pct((r) => r.hasAggregateRating),
    cityInTitle: pct((r) => r.titleHasCity),
    yearInTitle: pct((r) => r.yearInTitle),
    phoneOnPage: pct((r) => r.phonePresent),
    medianWordCount: wcs[Math.floor(wcs.length / 2)] ?? null,
    medianH2s: rows.map((r) => r.h2Count).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? null,
    linksToOwnBlog: pct((r) => r.blogLinkCount > 0),
    pageTypes: byType,
  };
}

export function renderSerpPlaybookMd({ winners = [], rollup = null, fps = [], cities = [], observations = [] } = {}, { nowIso = '' } = {}) {
  const ok = observations.filter((o) => o.status === 'ok').length;
  const blocked = observations.filter((o) => o.status === 'blocked').length;
  const clinics = winners.filter((w) => w.kind === 'clinic-candidate');
  const dirs = winners.filter((w) => w.kind !== 'clinic-candidate');
  return [
    '# Google SERP playbook — who ranks, with what pages, using what tactics', '',
    `Captured ${String(nowIso).slice(0, 10)} · ${ok} clean SERPs (${blocked} blocked rows EXCLUDED, never counted as zeros) · ${cities.length ? cities.join(' · ') : 'cities accruing'}.`, '',
    '## Clinics that own their city (recurrence-weighted across the money queries)',
    '| clinic site | score | best rank | # queries it ranks for | cities | ranking pages (best-first) |',
    '|-------------|-------|-----------|------------------------|--------|-----------------------------|',
    ...clinics.slice(0, 20).map((w) => `| ${w.domain} | ${w.score} | #${w.bestRank} | ${w.queryCount} | ${w.cities.join('; ')} | ${w.pages.slice(0, 3).map((p) => `${p.pageType}#${p.bestRank}`).join(', ')} |`),
    '', '## Directories/press holding the rest of page 1 (the listicle targets)',
    ...(dirs.length ? dirs.slice(0, 10).map((d) => `- ${d.domain} (score ${d.score}, best #${d.bestRank}, ${d.queryCount} queries)`) : ['_none captured yet_']),
    '', '## The shared tactic fingerprint (measured on the ranking pages themselves)',
    ...(rollup ? [
      `- **Schema:** ${Math.round(rollup.localBusinessSchema * 100)}% run LocalBusiness/MedicalBusiness JSON-LD · ${Math.round(rollup.faqSchema * 100)}% FAQ schema · ${Math.round(rollup.aggregateRating * 100)}% expose aggregateRating (review stars)`,
      `- **Titles:** ${Math.round(rollup.cityInTitle * 100)}% put the CITY in the title · ${Math.round(rollup.yearInTitle * 100)}% carry a year`,
      `- **Depth:** median ${rollup.medianWordCount} words, ${rollup.medianH2s} H2s on the ranking page · ${Math.round(rollup.linksToOwnBlog * 100)}% link out to their own /blog from it`,
      `- **Conversion surface:** ${Math.round(rollup.phoneOnPage * 100)}% have a phone number on the ranking page`,
      `- **What page ranks:** ${Object.entries(rollup.pageTypes).map(([k, v]) => `${k} ×${v}`).join(' · ')}`,
    ] : ['_fingerprints pending (run with --fingerprint)_']),
    '', '## Per-page fingerprints',
    '| page | type | rank-queries | schema | FAQ | stars | city-title | words | H2s | →blog |',
    '|------|------|--------------|--------|-----|-------|------------|-------|-----|-------|',
    ...fps.filter(Boolean).slice(0, 40).map((f) => `| ${f.url.slice(0, 60)} | ${f.pageType} | — | ${f.hasLocalBusiness ? '✓' : '—'} | ${f.hasFaqSchema ? '✓' : '—'} | ${f.hasAggregateRating ? '✓' : '—'} | ${f.titleHasCity ? '✓' : '—'} | ${f.wordCount} | ${f.h2Count} | ${f.blogLinkCount} |`),
    '', '_Blocked SERPs are excluded from every denominator. Winners feed blog-corpus (`--harvest`): their FULL blogs + voice land in research/blog-corpus/ as training data._',
  ].join('\n');
}

// ---- LIVE capture (stealth browser; injected in tests) ---------------------------------------

const uuleFor = (loc) => {
  const SECRET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const b64 = Buffer.from(String(loc), 'utf-8').toString('base64');
  return 'w+CAIQICI' + SECRET[Buffer.from(String(loc), 'utf-8').byteLength % 64] + b64;
};

async function serpBlocked(page) {
  try {
    if (/consent\.google\.com|\/sorry\/|sorry\.google|challenges\.cloudflare/i.test(page.url())) return true;
    return await page.evaluate(() => {
      const t = (document.body.innerText || '').toLowerCase();
      return /unusual traffic|detected unusual|are you a robot|verify you.?re human|before you continue/.test(t)
        || !!document.querySelector('#recaptcha, form#captcha, #captcha-form, iframe[src*="challenges.cloudflare"]');
    });
  } catch { return false; }
}

/** Accept Google's consent/cookie wall once so the profile accrues the SOCS/consent cookie (a
 *  cold, consent-less session is a top /sorry/ trigger). Best-effort — never throws. */
async function acceptConsent(page) {
  try {
    const btn = await page.$('button[aria-label*="Accept all" i], button[aria-label*="agree" i], #L2AGLb, form[action*="consent"] button');
    if (btn) { await btn.click().catch(() => {}); await page.waitForTimeout(1200); return true; }
    for (const f of page.frames()) {
      if (/consent\.google/i.test(f.url())) {
        const b = await f.$('button[aria-label*="Accept all" i], button:has-text("Accept all"), button:has-text("I agree")');
        if (b) { await b.click().catch(() => {}); await page.waitForTimeout(1200); return true; }
      }
    }
  } catch { /* */ }
  return false;
}

/** Drive real Google, one paced query at a time. onResult(obs, spec, idx) per spec; respects
 *  shouldStop(). Uses a WARM persistent profile (userDataDir) — real cookies + accepted consent are
 *  the biggest anti-/sorry/ lever on a single residential IP. Warms up on google.com first, paces
 *  like a human comparing spas. Headful (headless Google = instant captcha). */
export async function captureSerpBatch(specs = [], { onResult, shouldStop = () => false, headless = false, userDataDir = null, log = () => {} } = {}) {
  const launched = await launchBrowser({ headless, stealth: true, userDataDir, ignoreCdp: true });
  const handle = launched.context || launched.browser;
  if (!handle) throw new Error(`no browser driver (${launched.status}) — npm i patchright or playwright`);
  try {
    const ctx = launched.context || await launched.browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });
    const page = (launched.context && ctx.pages()[0]) || await ctx.newPage();
    // Warm-up: land on the homepage, accept consent, pause — establishes a human-looking session
    // before any /search hit.
    try { await page.goto('https://www.google.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }); await acceptConsent(page); await page.waitForTimeout(2000 + Math.random() * 2000); } catch { /* */ }
    for (let i = 0; i < specs.length; i++) {
      if (shouldStop()) break;
      const s = specs[i];
      const url = `https://www.google.com/search?q=${encodeURIComponent(s.query)}&num=20&hl=en&gl=us&pws=0&uule=${encodeURIComponent(uuleFor(s.city))}`;
      let obs;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await acceptConsent(page);
        await page.waitForTimeout(1500 + Math.random() * 2000);
        if (await serpBlocked(page)) {
          obs = { status: 'blocked', city: s.city, query: s.query, template: s.template, engine: s.engine, results: [], capturedAt: new Date().toISOString() };
        } else {
          const raw = await page.evaluate(() => {
            const out = [];
            document.querySelectorAll('#search a[href], #rso a[href]').forEach((a) => {
              const h3 = a.querySelector('h3');
              if (!h3 || !/^https?:/.test(a.href)) return;
              out.push({ url: a.href, title: h3.innerText.trim() });
            });
            return out;
          });
          const seen = new Set();
          const results = [];
          for (const r of raw) {
            const h = host(r.url);
            if (!h || /google\.|gstatic|googleusercontent|webcache/.test(h)) continue;
            const clean = r.url.replace(/[?#].*$/, '');
            if (seen.has(clean)) continue;
            seen.add(clean);
            results.push({ rank: results.length + 1, url: clean, host: h, title: r.title });
            if (results.length >= 20) break;
          }
          obs = { status: results.length ? 'ok' : 'empty', via: 'browser', city: s.city, query: s.query, template: s.template, engine: s.engine, results, capturedAt: new Date().toISOString() };
        }
      } catch (e) {
        obs = { status: 'error', error: String(e.message || e).slice(0, 160), city: s.city, query: s.query, template: s.template, engine: s.engine, results: [], capturedAt: new Date().toISOString() };
      }
      await onResult(obs, s, i);
      // Google flags faster than the AI engines (live: /sorry/ wall after ~6-8 rapid SERPs) — pace
      // like a human actually researching, not a crawler.
      if (i < specs.length - 1 && !shouldStop()) await page.waitForTimeout(humanDelayMs(30000, 75000));
    }
  } finally {
    if (launched.context) await launched.context.close().catch(() => {});
    else if (launched.browser) await launched.browser.close().catch(() => {});
  }
  return specs;
}

// ---- SCRAPLING backend (the Google anti-ban path) --------------------------------------------
// Camoufox (a hardened anti-detect Firefox) via the scraper/fetch.py sidecar fetches the SERP
// HTML with solve_cloudflare + Google's consent handled. It defeats bot-detection far better than
// a vanilla Playwright/patchright page (which Google walled after ~8 rapid queries live), so this
// is the DEFAULT backend on the Mini. Still paced + block-aware + cooldown-gated — stealth reduces
// the ban odds, it does not license volume.

const uuleUrl = (query, city) => `https://www.google.com/search?q=${encodeURIComponent(query)}&num=20&hl=en&gl=us&pws=0&uule=${encodeURIComponent(uuleFor(city))}`;

/** PURE: parse organic results out of a fetched Google SERP HTML string. Handles both the direct
 *  anchor→h3 form and the /url?q= redirect form; drops Google's own + tracking hosts. */
export function parseGoogleSerpHtml(html = '', { max = 20 } = {}) {
  const out = [];
  const seen = new Set();
  // Organic signature: an anchor whose subtree contains an <h3> before the anchor closes.
  for (const m of String(html).matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>((?:(?!<\/a>)[\s\S])*?<h3[^>]*>[\s\S]*?<\/h3>)/gi)) {
    let href = m[1];
    if (href.startsWith('/url?')) { try { const q = new URLSearchParams(href.slice(href.indexOf('?') + 1)).get('q'); if (q) href = q; } catch { /* */ } }
    if (!/^https?:/i.test(href)) continue;
    const h = host(href);
    if (!h || /(^|\.)(google\.|gstatic|googleusercontent|webcache|schema\.org)/.test(h)) continue;
    const clean = href.replace(/[?#].*$/, '');
    if (seen.has(clean)) continue;
    seen.add(clean);
    const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ rank: out.length + 1, url: clean, host: h, title });
    if (out.length >= max) break;
  }
  return out;
}

/** Scrapling capture path (Camoufox). Same obs shape + onResult contract as captureSerpBatch, so
 *  the runner is backend-agnostic. Paced between fetches (Camoufox is slower but that's the point). */
export async function captureSerpViaScrapling(specs = [], { onResult, shouldStop = () => false, python, script, log = () => {} } = {}) {
  if (!python || !script) throw new Error('captureSerpViaScrapling needs { python, script }');
  for (let i = 0; i < specs.length; i++) {
    if (shouldStop()) break;
    const s = specs[i];
    let obs;
    try {
      const r = await sidecarFetch(uuleUrl(s.query, s.city), { python, script, mode: 'stealth' });
      if (r.blocked || (!r.ok && /challenge|consent|sorry|unusual|robot|before you continue/i.test(r.note))) {
        obs = { status: 'blocked', city: s.city, query: s.query, template: s.template, engine: s.engine, results: [], note: r.note, capturedAt: new Date().toISOString() };
      } else if (!r.ok || !r.html) {
        obs = { status: 'error', error: r.note || 'no html', city: s.city, query: s.query, template: s.template, engine: s.engine, results: [], capturedAt: new Date().toISOString() };
      } else {
        const results = parseGoogleSerpHtml(r.html);
        obs = { status: results.length ? 'ok' : 'empty', via: 'scrapling', city: s.city, query: s.query, template: s.template, engine: s.engine, results, capturedAt: new Date().toISOString() };
      }
    } catch (e) {
      obs = { status: 'error', error: String(e.message || e).slice(0, 160), city: s.city, query: s.query, template: s.template, engine: s.engine, results: [], capturedAt: new Date().toISOString() };
    }
    await onResult(obs, s, i);
    // Pace between SERP fetches even through stealth — human research cadence, not a crawler.
    if (i < specs.length - 1 && !shouldStop()) await new Promise((r) => setTimeout(r, humanDelayMs(20000, 45000)));
  }
  return specs;
}

/** The runner: cooldown gate → cursor slice → capture (block circuit breaker) → analyze → docs.
 *  Everything external injected ({fs, capture}) so tests never touch a browser. */
export async function runSerpRadar(cfg = {}, {
  cities = [], templates = SERP_QUERY_TEMPLATES, fs, dir, capture = captureSerpBatch,
  maxPerRun = 24, log = () => {}, nowIso = new Date().toISOString(),
  cooldownMs = SAFE_DEFAULTS.cooldownMs,
} = {}) {
  if (!fs || !dir) throw new Error('runSerpRadar needs { fs, dir }');
  fs.mkdirSync(dir, { recursive: true });
  const ndjson = `${dir}/serp-observations.ndjson`;
  const cursorFile = `${dir}/.cursor`;
  const cooldownFile = `${dir}/.cooldown`;

  const nowMs = Date.parse(nowIso) || Date.now();
  if (fs.existsSync(cooldownFile)) {
    const cd = inCooldown(Number(fs.readFileSync(cooldownFile, 'utf8').trim()) || 0, nowMs, cooldownMs);
    if (cd.cooling) {
      log(`  🧊 serp-radar in COOLDOWN after a prior block-halt — ${Math.ceil(cd.remainingMs / 60000)} min remaining (IP safety). Resumes automatically.`);
      return { captured: 0, halted: false, cooling: true, remainingMs: cd.remainingMs };
    }
  }

  const specs = buildSerpSpecs(cities, templates);
  if (!specs.length) return { captured: 0, halted: false, note: 'no cities' };
  const cursor = fs.existsSync(cursorFile) ? (Number(fs.readFileSync(cursorFile, 'utf8').trim()) || 0) % specs.length : 0;
  const slice = specs.slice(cursor, cursor + maxPerRun);
  log(`  serp-radar: ${specs.length} (city×query) cells · resuming at #${cursor + 1} · ≤${slice.length} this run`);

  let captured = 0, consecutiveBlocks = 0, halted = false;
  await capture(slice, {
    shouldStop: () => halted,
    log,
    onResult: async (obs) => {
      fs.appendFileSync(ndjson, JSON.stringify(obs) + '\n');
      if (obs.status === 'ok') { captured++; consecutiveBlocks = 0; log(`  [serp] ${obs.city} · "${obs.query}" → ${obs.results.length} organic`); }
      else if (obs.status === 'blocked') { consecutiveBlocks++; log(`  [serp] ⛔ BLOCKED ${obs.city} · "${obs.query}" (${consecutiveBlocks} consecutive)`); if (consecutiveBlocks >= 2) halted = true; }
      else log(`  [serp] ${obs.status} ${obs.city} · "${obs.query}"${obs.error ? ` — ${obs.error}` : ''}`);
    },
  });
  fs.writeFileSync(cursorFile, String((cursor + slice.length) >= specs.length ? 0 : cursor + slice.length));
  if (halted) { fs.writeFileSync(cooldownFile, String(nowMs)); log('  serp-radar: HALTED on consecutive blocks — cooldown stamped (never re-hammer a flagged IP)'); }

  const all = fs.existsSync(ndjson) ? fs.readFileSync(ndjson, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const winners = serpWinners(all);
  fs.writeFileSync(`${dir}/serp-winners.json`, JSON.stringify({ builtAt: nowIso, winners }, null, 2));
  return { captured, halted, accrued: all.filter((o) => o.status === 'ok').length, totalCells: specs.length, winners, observations: all };
}
