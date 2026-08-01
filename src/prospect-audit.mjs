// seo-bot · prospect-audit — the PRE-CALL AUDIT DECK for a CONFIRMED lead.
//
// Turns one domain into a self-contained, shareable HTML audit deck (the
// Refine-by-Tulsi genre: verdict → scorecard → website/SEO/AEO teardown →
// booking & conversion → top fixes → roadmap → measured appendix). The deck
// serves two calls: call 1 (ammo — where it hurts) and call 3 (the website
// upsell — speed/booking/on-page findings, not just AEO citations).
//
// Design constraints:
//   * DETERMINISTIC + fail-soft: every probe is optional; a dead probe renders
//     as "not measured", never throws the order. No LLM, no browser.
//   * Everything interpolated into HTML goes through esc() — crawled titles
//     are attacker-controlled bytes.
//   * Prospect namespace only: this module never touches client reports.
//   * Panel/serp lookups read the LOCAL accrual files (reports/query-bank/*,
//     research/serp-playbook/*) — never fire live engine queries; the two-lane
//     collectors own those budgets and their anti-ban limits.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as cheerio from 'cheerio';
import { ROOT } from './config.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// The engines a med-spa actually gets recommended by. Blocking the first three
// is the single most self-defeating robots.txt line a prospect can have.
export const AI_AGENTS = ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'Bingbot'];

// Booking platforms we can detect from href/src hosts (label shown in the deck).
export const BOOKING_PROVIDERS = [
  ['vagaro.com', 'Vagaro'], ['joinblvd.com', 'Boulevard'], ['blvd.co', 'Boulevard'],
  ['jane.app', 'Jane'], ['janeapp.com', 'Jane'], ['mindbodyonline.com', 'Mindbody'],
  ['acuityscheduling.com', 'Acuity'], ['calendly.com', 'Calendly'],
  ['squareup.com', 'Square Appointments'], ['square.site', 'Square Appointments'],
  ['glossgenius.com', 'GlossGenius'], ['zenoti.com', 'Zenoti'], ['booker.com', 'Booker'],
  ['myaestheticspro.com', 'AestheticsPro'], ['aestheticrecord.com', 'Aesthetic Record'],
  ['joinmoxie.com', 'Moxie'], ['moxieapp.com', 'Moxie'], ['boulevard.io', 'Boulevard'],
  ['leadconnectorhq.com', 'HighLevel booking'], ['msgsndr.com', 'HighLevel booking'],
  ['repeatmd.com', 'RepeatMD'], ['patientnow.com', 'PatientNow'],
];

const SOCIAL_HOSTS = ['instagram.com', 'facebook.com', 'tiktok.com', 'youtube.com', 'linkedin.com', 'yelp.com'];

// Minimum accrued answers before ANY "you appear in 0 of N" claim is allowed anywhere
// (deck bignum, grade, fixes, ammo card). A "0/19" reads as a rigged prop — below this
// floor the deck says the honest thing instead: "your metro isn't sampled yet".
// Positive hits may always be shown (real data at any sample size).
export const PANEL_CLAIM_MIN = 150;

const LOCAL_BUSINESS_TYPES = new Set(['LocalBusiness', 'MedicalBusiness', 'MedicalClinic', 'HealthAndBeautyBusiness',
  'DaySpa', 'MedSpa', 'BeautySalon', 'HealthClub', 'Dentist', 'Physician']);

// ---------------------------------------------------------------- tiny utils

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function timedFetch(fetchImpl, url, { ms = 15000, headers = {} } = {}) {
  const t0 = Date.now();
  const res = await fetchImpl(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...headers },
    signal: AbortSignal.timeout(ms),
  });
  const headerMs = Date.now() - t0;
  const text = await res.text();
  return { res, text, headerMs, totalMs: Date.now() - t0 };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---------------------------------------------------------------- robots.txt for AI bots

/** Minimal robots parser: groups of user-agents with allow/disallow rules. */
export function parseRobotsGroups(text) {
  const groups = [];
  let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(); const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  return groups;
}

/** Longest-match evaluation of "/" for one agent (case-insensitive; falls back to '*' group). */
export function agentAllowed(groups, agent, path = '/') {
  const a = String(agent).toLowerCase();
  let grp = groups.find((g) => g.agents.some((x) => x !== '*' && (a.includes(x) || x.includes(a))));
  if (!grp) grp = groups.find((g) => g.agents.includes('*'));
  if (!grp) return true; // no rules at all → allowed
  let best = null;
  for (const r of grp.rules) {
    if (r.path === '') { if (!best) best = { ...r, path: '' }; continue; } // empty Disallow = allow-all
    if (path.startsWith(r.path) && (!best || r.path.length > best.path.length)) best = r;
  }
  if (!best) return true;
  if (best.path === '') return true;
  return best.allow;
}

async function probeRobotsAi(baseUrl, fetchImpl, log) {
  try {
    const { res, text } = await timedFetch(fetchImpl, new URL('/robots.txt', baseUrl).href, { ms: 10000 });
    if (!res.ok) return { found: false, bots: AI_AGENTS.map((a) => ({ agent: a, allowed: true, note: 'no robots.txt' })) };
    const groups = parseRobotsGroups(text);
    return { found: true, bots: AI_AGENTS.map((a) => ({ agent: a, allowed: agentAllowed(groups, a) })) };
  } catch (e) { log(`  prospect: robots probe failed (${String(e.message || e).slice(0, 60)})`); return null; }
}

// ---------------------------------------------------------------- homepage probe

function collectJsonLdTypes(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) collectJsonLdTypes(n, out); return; }
  const t = node['@type'];
  if (typeof t === 'string') out.types.add(t);
  else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') out.types.add(x);
  if (LOCAL_BUSINESS_TYPES.has(typeof t === 'string' ? t : (Array.isArray(t) ? t.find((x) => LOCAL_BUSINESS_TYPES.has(x)) : ''))) {
    if (!out.nap.name && typeof node.name === 'string') out.nap.name = node.name;
    if (!out.nap.telephone && typeof node.telephone === 'string') out.nap.telephone = node.telephone;
    const ad = node.address && typeof node.address === 'object' ? node.address : null;
    if (ad && !out.nap.address) {
      out.nap.address = [ad.streetAddress, ad.addressLocality, ad.addressRegion].filter((x) => typeof x === 'string').join(', ');
      if (typeof ad.addressLocality === 'string') out.nap.city = ad.addressLocality;
      if (typeof ad.addressRegion === 'string') out.nap.region = ad.addressRegion;
    }
    // Some sites put address as a plain STRING (or leave the object empty — Parfaire does);
    // keep the raw string so the city can still be parsed out of it downstream.
    if (!out.nap.address && typeof node.address === 'string' && node.address.trim()) out.nap.address = node.address.trim();
    if (Array.isArray(node.sameAs)) for (const s of node.sameAs) if (typeof s === 'string') out.sameAs.add(s);
  }
  if (node['@graph']) collectJsonLdTypes(node['@graph'], out);
}

async function probeHome(baseUrl, fetchImpl, log) {
  try {
    const { res, text, headerMs, totalMs } = await timedFetch(fetchImpl, baseUrl, { ms: 20000 });
    const $ = cheerio.load(text || '');
    const jsonLd = { types: new Set(), nap: {}, sameAs: new Set() };
    $('script[type="application/ld+json"]').each((_, el) => {
      try { collectJsonLdTypes(JSON.parse($(el).contents().text()), jsonLd); } catch { /* malformed block = ignored */ }
    });
    const hrefs = []; $('a[href]').each((_, el) => hrefs.push(String($(el).attr('href') || '')));
    const srcs = []; $('script[src],iframe[src],link[href]').each((_, el) => srcs.push(String($(el).attr('src') || $(el).attr('href') || '')));
    const all = hrefs.concat(srcs).map((u) => u.toLowerCase());
    const provider = BOOKING_PROVIDERS.find(([host]) => all.some((u) => u.includes(host)));
    // The actual booking destination (for the deck's booking-flow screenshot): prefer a real
    // provider link; fall back to the first on-site "book/appointment" link.
    let bookingUrl = null;
    const rawBookingHref = provider
      ? hrefs.find((u) => u.toLowerCase().includes(provider[0]))
      : hrefs.find((u) => /book|appointment|schedule/i.test(u) && !/^(#|tel:|mailto:)/i.test(u));
    if (rawBookingHref) { try { bookingUrl = new URL(rawBookingHref, res.url || baseUrl).href; } catch { bookingUrl = null; } }
    const bookingWords = hrefs.filter((u) => /book|appointment|schedule|consult/i.test(u)).length;
    // Interior services/treatments page (the deck's second site shot) — same-host only, and
    // never the booking link itself.
    let servicesUrl = null;
    const rawSvcHref = hrefs.find((u) => /service|treatment|botox|filler|injectable|procedure|menu/i.test(u)
      && !/^(#|tel:|mailto:)/i.test(u) && !/book|appointment|schedule/i.test(u));
    if (rawSvcHref) {
      try {
        const su = new URL(rawSvcHref, res.url || baseUrl);
        if (su.host === new URL(res.url || baseUrl).host) servicesUrl = su.href;
      } catch { servicesUrl = null; }
    }
    const imgs = $('img'); let missingAlt = 0;
    imgs.each((_, el) => { if (!String($(el).attr('alt') || '').trim()) missingAlt++; });
    const types = [...jsonLd.types];
    const html = text || '';
    const platform =
      /wp-content|wp-includes/i.test(html) ? 'WordPress'
      : /wixstatic\.com|parastorage\.com/i.test(html) ? 'Wix'
      : /squarespace\.com|sqsp\.net|squarespace-cdn/i.test(html) ? 'Squarespace'
      : /cdn\.shopify\.com/i.test(html) ? 'Shopify'
      : /webflow/i.test(html) ? 'Webflow'
      : /msgsndr\.com|leadconnectorhq\.com/i.test(html) ? 'HighLevel funnel'
      : /kajabi/i.test(html) ? 'Kajabi'
      : /duda(one|mobile)|dmws/i.test(html) ? 'Duda'
      : (String($('meta[name="generator"]').attr('content') || '').split(' ')[0] || null);
    // Content-level AEO signals readable in RAW HTML — no schema required. AI crawlers read
    // these same bytes, so a real FAQ section or a named practitioner earns credit even when
    // no JSON-LD wraps it (the grade must measure reality, not whether they bought markup).
    const bodyText = String($('body').text() || '').replace(/\s+/g, ' ');
    let faqQuestions = 0;
    $('h2,h3,h4,h5,summary,dt,button,strong,b').each((_, el) => {
      const t = String($(el).text() || '').trim();
      if (t.length >= 10 && t.length <= 160 && /\?$/.test(t)) faqQuestions++;
    });
    const practitionerText =
      /,\s*(?:MD|DO|NP|RN|PA-C|FNP|DNP|CRNA|APRN)\b/.test(bodyText) ||
      /\b(?:nurse\s+(?:practitioner|injector)|medical\s+director|physician|dermatologist|plastic\s+surgeon|a?esthetician|injector|board.certified)\b/i.test(bodyText);
    const addressVisible = /\b\d{1,5}\s+[A-Za-z0-9.' -]{3,40}\s(?:Ave(?:nue)?|Blvd|Boulevard|St(?:reet)?|R(?:oa)?d|Dr(?:ive)?|Suite|Ste|Hwy|Highway|Pkwy|Parkway|Way|Ln|Lane|Ct|Court|Pl(?:ace)?)\b/i.test(bodyText) || !!jsonLd.nap.address;
    // Lead-city detection ("City ST", the query bank's format) for the on-demand market
    // sample: JSON-LD locality first, else parse "City, ST 12345" from the schema address
    // string, else from the visible page text — LAST match wins there, because the page's
    // own footer NAP closes the document while testimonials/blogs naming other cities don't.
    const cityStZip = /,\s*([A-Za-z][A-Za-z .'-]{2,28}?),?\s+([A-Z]{2})[ ,]+\d{5}/g;
    let cityGuess = jsonLd.nap.city ? `${jsonLd.nap.city}${jsonLd.nap.region ? ` ${jsonLd.nap.region}` : ''}` : null;
    if (!cityGuess && jsonLd.nap.address) {
      const m = [...String(jsonLd.nap.address).matchAll(cityStZip)];
      if (m.length) cityGuess = `${m[0][1].trim()} ${m[0][2]}`;
    }
    if (!cityGuess) {
      const m = [...bodyText.matchAll(cityStZip)];
      if (m.length) { const last = m[m.length - 1]; cityGuess = `${last[1].trim()} ${last[2]}`; }
    }
    return {
      status: res.status,
      https: String(res.url || baseUrl).startsWith('https://'),
      finalUrl: res.url || baseUrl,
      ttfbMs: headerMs, totalMs,
      htmlKb: Math.round((html.length / 1024) * 10) / 10,
      title: String($('title').first().text() || '').trim().slice(0, 200),
      metaDescription: String($('meta[name="description"]').attr('content') || '').trim().slice(0, 300),
      h1: String($('h1').first().text() || '').trim().replace(/\s+/g, ' ').slice(0, 200),
      brandGuess: String($('meta[property="og:site_name"]').attr('content') || jsonLd.nap.name || '').trim().slice(0, 120) || null,
      viewport: $('meta[name="viewport"]').length > 0,
      canonical: String($('link[rel="canonical"]').attr('href') || '') || null,
      scripts: $('script[src]').length,
      images: imgs.length, imagesMissingAlt: missingAlt,
      wordCount: Math.round(bodyText.trim().split(' ').length),
      faqQuestions, practitionerText, addressVisible, cityGuess,
      telLink: hrefs.some((u) => u.toLowerCase().startsWith('tel:')),
      mapsLink: all.some((u) => /google\.[a-z.]+\/maps|maps\.app\.goo|goo\.gl\/maps/.test(u)),
      socials: SOCIAL_HOSTS.filter((h) => all.some((u) => u.includes(h))),
      booking: { provider: provider ? provider[1] : null, ctaLinks: bookingWords, url: bookingUrl },
      servicesUrl,
      schema: {
        types,
        hasLocalBusiness: types.some((t) => LOCAL_BUSINESS_TYPES.has(t)),
        hasPhysician: types.includes('Physician') || types.includes('Person'),
        hasFaq: types.includes('FAQPage'),
        hasService: types.includes('Service') || types.includes('MedicalProcedure'),
        hasRatings: types.includes('AggregateRating') || types.includes('Review'),
        sameAs: [...jsonLd.sameAs].slice(0, 8),
        nap: jsonLd.nap,
      },
      platform,
    };
  } catch (e) { log(`  prospect: homepage probe failed (${String(e.message || e).slice(0, 80)})`); return null; }
}

// ---------------------------------------------------------------- live screenshots (the deck's proof shots)

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
// Per-shot + combined caps keep the deck JSON safely under the store's 1MB contents-API read
// limit (the images ride inside the deck HTML as data URIs so the page stays self-contained
// and printable). Anything over cap gets a lower-quality retry, then is dropped — fail-soft.
// Sized so a 4-shot deck stays well under GitHub's contents-API ceilings END TO END: raw JPEGs
// ≤430KB → ~590KB as data URIs → deck JSON ~620KB → PUT body (base64-again) ~830KB. The first
// cap set (520KB raw) produced a ~1.1MB PUT that GitHub REJECTED — silently, pre --fail-with-body.
// v2 (booking section removed): desktop 150 + mobile 90 + services 80 + ai 110 = 430KB total.
// `ai` is the live-ChatGPT-answer shot (precall-ai-shot.mjs) — captured separately, budgeted here.
const SHOT_CAPS = { desktop: 150 * 1024, mobile: 90 * 1024, services: 80 * 1024, ai: 110 * 1024, total: 430 * 1024 };

/** Capture desktop/mobile homepage + services-page screenshots as JPEG data URIs.
 *  Own headless Chromium ONLY (ignoreCdp — never the logged-in ChatGPT session). Fail-soft:
 *  any error, a blocked render, or an over-budget image → that shot is null; all-null → null. */
export async function probeShots({ baseUrl, servicesUrl = null, log = () => {} } = {}) {
  if (process.env.SEO_BOT_PROSPECT_SHOTS === '0') return null;
  let L = null;
  try {
    const { launchBrowser } = await import('./measure/browser.mjs');
    L = await launchBrowser({ headless: true, stealth: false, ignoreCdp: true });
  } catch (e) { log(`  prospect: shots skipped (browser: ${String(e.message || e).slice(0, 60)})`); return null; }
  if (!L || L.status) { log(`  prospect: shots skipped (${(L && L.status) || 'no browser'})`); return null; }
  const browser = L.browser;
  const grab = async (url, key, { mobile = false } = {}) => {
    let context = null;
    try {
      context = await browser.newContext(mobile
        ? { viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, isMobile: true, hasTouch: true }
        : { viewport: { width: 1366, height: 900 } });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load', timeout: 30000 })
        .catch(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }));
      await page.waitForTimeout(2500);                       // fonts + hero media settle
      await page.keyboard.press('Escape').catch(() => {});   // best-effort popup dismiss
      let buf = await page.screenshot({ type: 'jpeg', quality: 60 });
      if (buf.length > SHOT_CAPS[key]) buf = await page.screenshot({ type: 'jpeg', quality: 35 });
      if (buf.length > SHOT_CAPS[key]) return null;
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch { return null; }
    finally { if (context) await context.close().catch(() => {}); }
  };
  const shots = { desktop: null, mobile: null, services: null };
  try {
    shots.desktop = await grab(baseUrl, 'desktop');
    shots.mobile = await grab(baseUrl, 'mobile', { mobile: true });
    if (servicesUrl) shots.services = await grab(servicesUrl, 'services');
  } finally { await browser.close().catch(() => {}); }
  // Combined budget: drop the least-essential shots first rather than risking the store cap.
  const size = (u) => (u ? u.length : 0);
  if (size(shots.desktop) + size(shots.mobile) + size(shots.services) > SHOT_CAPS.total * 1.4) shots.services = null;
  if (size(shots.desktop) + size(shots.mobile) > SHOT_CAPS.total * 1.4) shots.mobile = null;
  if (!shots.desktop && !shots.mobile && !shots.services) { log('  prospect: site blocked headless rendering — deck ships without shots'); return null; }
  log(`  prospect: shots captured (desktop ${shots.desktop ? '✓' : '—'} · mobile ${shots.mobile ? '✓' : '—'} · services ${shots.services ? '✓' : '—'})`);
  return shots;
}

// ---------------------------------------------------------------- PageSpeed (keyless, best-effort)

async function probePsi(domain, fetchImpl, log) {
  if (process.env.SEO_BOT_PSI === '0') return null;
  try {
    const u = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(`https://${domain}/`)}&strategy=mobile&category=performance`;
    const res = await fetchImpl(u, { signal: AbortSignal.timeout(75000), headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const j = await res.json();
    const lh = j && j.lighthouseResult;
    if (!lh) return null;
    const audit = (k) => lh.audits && lh.audits[k] && lh.audits[k].displayValue || null;
    return {
      performance: num(lh.categories?.performance?.score) != null ? Math.round(lh.categories.performance.score * 100) : null,
      lcp: audit('largest-contentful-paint'), cls: audit('cumulative-layout-shift'),
      tbt: audit('total-blocking-time'), fcp: audit('first-contentful-paint'),
    };
  } catch (e) { log(`  prospect: PSI unavailable (${String(e.message || e).slice(0, 60)})`); return null; }
}

// ---------------------------------------------------------------- local accrual lookups (NO live queries)

const normText = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Scan every tracked query-bank panel for the prospect's domain/brand. Read-only local files.
 *  Pass `city` ("Pasadena CA") to ALSO get city-scoped stats for the lead's own market —
 *  citySampled/cityHits/cityLastDay — the numbers the deck is allowed to claim out loud. */
export function panelLookup({ domain, brand, city = null, root = ROOT, fsi = { readFileSync, readdirSync, existsSync } } = {}) {
  const base = join(root, 'reports', 'query-bank');
  if (!fsi.existsSync(base)) return null;
  const domNeedle = String(domain || '').toLowerCase().replace(/^www\./, '');
  const brandNeedle = normText(brand);
  const useBrand = brandNeedle.length >= 5;
  const cityNeedle = normText(city);
  let sampled = 0, hits = 0, lastDay = '';
  let citySampled = 0, cityHits = 0, cityLastDay = '';
  const cities = new Set(); const hitCities = new Set();
  let dirs = [];
  try { dirs = fsi.readdirSync(base); } catch { return null; }
  for (const c of dirs) {
    const f = join(base, c, 'observations.ndjson');
    if (!fsi.existsSync(f)) continue;
    let text = ''; try { text = String(fsi.readFileSync(f, 'utf-8')); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let row; try { row = JSON.parse(line); } catch { continue; }
      if (row.status !== 'ok') continue;
      sampled++;
      if (row.city) cities.add(row.city);
      if (typeof row.day === 'string' && row.day > lastDay) lastDay = row.day;
      const inCity = !!cityNeedle && normText(row.city) === cityNeedle;
      if (inCity) { citySampled++; if (typeof row.day === 'string' && row.day > cityLastDay) cityLastDay = row.day; }
      const hay = (JSON.stringify(row.ranked || []) + ' ' + ((row.citations && row.citations.urls) || []).join(' ') + ' ' + (row.answerExcerpt || '')).toLowerCase();
      if ((domNeedle && hay.includes(domNeedle)) || (useBrand && normText(hay).includes(brandNeedle))) {
        hits++; if (row.city) hitCities.add(row.city);
        if (inCity) cityHits++;
      }
    }
  }
  if (!sampled) return null;
  return {
    sampled, hits, cities: cities.size, cityNames: [...cities].slice(0, 40), hitCities: [...hitCities].slice(0, 6), lastDay,
    ...(cityNeedle ? { city, citySampled, cityHits, cityLastDay } : {}),
  };
}

/** Minimum city-scoped answers before the deck claims a number for the lead's own market. */
export const CITY_CLAIM_MIN = 8;

/** Same idea over the Google serp-radar accrual (substring on raw rows — domains only). */
export function serpLookup({ domain, root = ROOT, fsi = { readFileSync, readdirSync, existsSync } } = {}) {
  const base = join(root, 'research', 'serp-playbook');
  if (!fsi.existsSync(base)) return null;
  const needle = String(domain || '').toLowerCase().replace(/^www\./, '');
  if (!needle) return null;
  let sampled = 0, hits = 0;
  let dirs = [];
  try { dirs = fsi.readdirSync(base); } catch { return null; }
  for (const c of dirs) {
    const f = join(base, c, 'serp-observations.ndjson');
    if (!fsi.existsSync(f)) continue;
    let text = ''; try { text = String(fsi.readFileSync(f, 'utf-8')); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      sampled++;
      if (line.toLowerCase().includes(needle)) hits++;
    }
  }
  if (!sampled) return null;
  return { sampled, hits };
}

// ---------------------------------------------------------------- grading

export function letterFor(score) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s >= 93) return 'A'; if (s >= 88) return 'A-'; if (s >= 82) return 'B+'; if (s >= 75) return 'B';
  if (s >= 68) return 'B-'; if (s >= 60) return 'C+'; if (s >= 52) return 'C'; if (s >= 44) return 'C-';
  if (s >= 35) return 'D'; return 'F';
}

export function gradeWebsite(home, psi) {
  if (!home) return { score: null, notes: ['homepage unreachable'] };
  let s = 100; const notes = [];
  if (!home.https) { s -= 25; notes.push('no HTTPS'); }
  if (home.ttfbMs > 1500) { s -= 25; notes.push(`slow server (${(home.ttfbMs / 1000).toFixed(1)}s to first byte)`); }
  else if (home.ttfbMs > 900) { s -= 15; notes.push(`sluggish server (${(home.ttfbMs / 1000).toFixed(1)}s to first byte)`); }
  else if (home.ttfbMs > 500) { s -= 6; }
  if (psi && psi.performance != null) {
    if (psi.performance < 40) { s -= 22; notes.push(`mobile performance ${psi.performance}/100`); }
    else if (psi.performance < 60) { s -= 12; notes.push(`mobile performance ${psi.performance}/100`); }
    else if (psi.performance < 80) { s -= 5; }
  }
  if (home.htmlKb > 1500) { s -= 12; notes.push('very heavy HTML document'); }
  else if (home.htmlKb > 600) { s -= 6; }
  if (!home.viewport) { s -= 15; notes.push('no mobile viewport tag'); }
  if (home.images > 3 && home.imagesMissingAlt / home.images > 0.4) { s -= 8; notes.push(`${home.imagesMissingAlt}/${home.images} images missing alt text`); }
  if (home.scripts > 45) { s -= 10; notes.push(`${home.scripts} external scripts`); }
  else if (home.scripts > 25) { s -= 5; }
  return { score: Math.max(5, Math.round(s)), notes };
}

export function gradeSeo(audit, home) {
  if (!audit || audit.score == null) return { score: null, notes: ['crawl audit unavailable'] };
  let s = audit.score; const notes = [];
  if (audit.sitemapFound === false) { s = Math.min(s, 68); notes.push('no sitemap.xml'); }
  if (home) {
    if (!home.title) { s -= 6; notes.push('homepage has no <title>'); }
    if (!home.metaDescription) { s -= 5; notes.push('homepage has no meta description'); }
    if (!home.h1) { s -= 4; notes.push('homepage has no H1'); }
  }
  return { score: Math.max(5, Math.min(100, Math.round(s))), notes };
}

/** Only claim "invisible in AI answers" when the panel actually sampled THEIR market —
 *  penalizing a prospect for absence from metros we don't track is how a deck stops
 *  being an audit and starts being a prop. Substring both ways: "pasadena" ↔ "pasadena-ca". */
export function panelCoversMarket(home, panel) {
  const city = String((home && home.schema && home.schema.nap && home.schema.nap.city) || '').trim().toLowerCase();
  if (!city || !panel || !Array.isArray(panel.cityNames)) return false;
  return panel.cityNames.some((c) => {
    const cc = String(c).toLowerCase();
    return cc.includes(city) || city.includes(cc);
  });
}

export function gradeAeo({ home, robotsAi, panel } = {}) {
  // Recalibrated 2026-07-23 (Shubh: decks read as skewed — grade reality, not our product).
  // Four evidence tiers, weighted by what actually decides AI visibility:
  //   ACCESS   — can AI crawlers fetch + read the site (the one true gate; biggest weights)
  //   SUBSTANCE — answer-shaped content; real FAQ text counts WITHOUT schema
  //   ENTITY   — can a machine tell who/where this business is; visible NAP counts, schema is bonus
  //   OBSERVED — tracked-panel appearances, penalized only when we sampled their market
  // passes[] carries what they already do right — shown in the deck; honesty is the pitch.
  if (!home) return { score: null, notes: ['homepage unreachable'], passes: [] };
  let s = 100; const notes = []; const passes = [];
  const schema = home.schema;

  const blocked = ((robotsAi && robotsAi.bots) || []).filter((b) => !b.allowed);
  const botWeight = { GPTBot: 18, 'OAI-SearchBot': 8, PerplexityBot: 8, ClaudeBot: 6, 'Google-Extended': 4, Bingbot: 6 };
  const botCut = blocked.reduce((acc, b) => acc + (botWeight[b.agent] || 4), 0);
  if (botCut) { s -= Math.min(30, botCut); notes.push(`${blocked.map((b) => b.agent).join(', ')} blocked in robots.txt`); }
  else if (robotsAi) passes.push('all major AI crawlers allowed');
  if (home.wordCount < 120) { s -= 15; notes.push(`homepage serves almost no readable text without JavaScript (${home.wordCount} words) — most AI crawlers read raw HTML only`); }
  else if (home.wordCount < 300) { s -= 7; notes.push(`thin readable text in raw HTML (${home.wordCount} words)`); }
  else passes.push(`${home.wordCount} words readable without JavaScript`);

  const hasFaqContent = (home.faqQuestions || 0) >= 3;
  if (schema && schema.hasFaq) passes.push('FAQ schema present');
  else if (hasFaqContent) { s -= 3; notes.push(`FAQ-style content found (${home.faqQuestions} questions) but not marked up as FAQPage schema`); }
  else { s -= 10; notes.push('no FAQ / answer-shaped content found on the homepage'); }

  if (schema && schema.hasLocalBusiness) passes.push('LocalBusiness/MedSpa schema present');
  else if (home.telLink && (home.addressVisible || home.mapsLink)) { s -= 8; notes.push('identity readable (phone + address on page) but not structured — no LocalBusiness/MedSpa schema'); }
  else { s -= 14; notes.push('no machine-readable business identity (no schema; phone/address not detectable in HTML)'); }
  if (schema && schema.hasPhysician) passes.push('practitioner (Physician/Person) markup present');
  else if (home.practitionerText) { s -= 3; notes.push('practitioners named in page text but not marked up (Physician/Person schema)'); }
  else { s -= 6; notes.push('no named practitioner AI can attribute medical expertise to'); }
  const socials = new Set([...(home.socials || []), ...((schema && schema.sameAs) || [])]);
  if (socials.size < 2) { s -= 5; notes.push('thin entity footprint (few sameAs/social profiles)'); }
  else passes.push(`entity corroborated across ${socials.size} external profiles`);

  // City-scoped live sample (the on-demand burst for the lead's own metro) outranks the
  // global accrual: a number measured for THEIR market this week is the only claim worth making.
  if (panel && (panel.citySampled || 0) >= CITY_CLAIM_MIN) {
    if (panel.cityHits > 0) passes.push(`named in ${panel.cityHits} of ${panel.citySampled} live AI answers for ${panel.city}`);
    else { s -= 8; notes.push(`0 appearances in ${panel.citySampled} live AI answers for ${panel.city} (sampled ${panel.cityLastDay || 'this week'})`); }
  } else if (panel && panel.hits > 0) passes.push(`already named in ${panel.hits} of ${panel.sampled} tracked AI answers`);
  else if (panel && panel.sampled >= PANEL_CLAIM_MIN) {
    if (panelCoversMarket(home, panel)) { s -= 8; notes.push(`0 appearances in ${panel.sampled} tracked AI answers covering their market`); }
    else notes.push(`AI-answer panel hasn't sampled their metro yet — unmeasured, no penalty applied`);
  }
  return { score: Math.max(5, Math.round(s)), notes, passes };
}

export function verdictFor({ brand, domain, site, seo, aeo } = {}) {
  const s = site.score ?? 0, o = seo.score ?? 0, a = aeo.score ?? 0;
  if (s < 52) return {
    head: `${brand}'s website is quietly losing patients — before Google or AI even weigh in.`,
    sub: `The teardown below is measured, not estimated: load speed, mobile experience, booking flow and on-page structure on ${domain}, plus how visible the practice is to the AI engines patients now ask first.`,
  };
  if (a < 58 && s >= 70) return {
    head: `The website is genuinely solid — so why isn't AI recommending ${brand}?`,
    sub: `Fundamentals are stronger than most practices we audit. The gap is machine-facing: the signals ChatGPT, Perplexity and Google AI need to confidently name ${brand} are thin or missing — and that's exactly the fixable part.`,
  };
  if (a >= 70 && s >= 72 && o >= 70) return {
    head: `Strong foundations. The next gap is compounding authority — and it's winnable.`,
    sub: `${domain} passes most of what we measure. What remains is the authority layer: being the answer AI engines and Google reach for in your market, week after week.`,
  };
  if (o < 55 && s >= 60) return {
    head: `The site looks fine to visitors — search engines see much less.`,
    sub: `Visitors get a decent experience on ${domain}; crawlers and answer engines don't. The findings below show exactly what they're missing and the order we'd fix it in.`,
  };
  return {
    head: `A real audit of ${domain}: what's working, what's leaking, and what pays first.`,
    sub: `Website health, traditional SEO and AI visibility — measured live on ${domain}, graded honestly, with the three fixes we'd start with.`,
  };
}

// ---------------------------------------------------------------- fixes + upsell angles

export function topFixesFor({ home, robotsAi, panel, audit, proposals } = {}) {
  const fixes = [];
  const blocked = (robotsAi && robotsAi.bots || []).filter((b) => !b.allowed && ['GPTBot', 'ClaudeBot', 'PerplexityBot'].includes(b.agent));
  if (blocked.length) fixes.push({
    title: `Unblock AI crawlers (${blocked.map((b) => b.agent).join(', ')})`,
    why: 'ChatGPT, Claude and Perplexity literally cannot read the site — the practice is invisible to AI recommendations by its own robots.txt.',
    evidence: `robots.txt disallows ${blocked.map((b) => b.agent).join(' + ')} from the whole site`,
    angle: 'Fifteen-minute fix, day one of an engagement.',
  });
  if (home && !home.booking.provider) fixes.push({
    title: 'No online booking platform detected',
    why: 'After-hours leads have nowhere to convert — competitors with Boulevard/Vagaro/Jane book patients while the front desk is closed.',
    evidence: `no booking provider found in the homepage's links, scripts or embeds (${home.booking.ctaLinks} generic "book" links)`,
    angle: 'This is the call-3 website pitch: a booking-first rebuild.',
  });
  if (home && (home.ttfbMs > 1200 || false)) fixes.push({
    title: 'Slow server response',
    why: 'Every second of wait costs mobile patients; speed is also a ranking and crawl-budget input.',
    evidence: `${(home.ttfbMs / 1000).toFixed(1)}s to first byte, measured live`,
    angle: 'Hosting/stack fix or rebuild on a fast stack — quantifiable win in week one.',
  });
  if (home && home.schema && !home.schema.hasLocalBusiness) fixes.push({
    title: 'Add LocalBusiness/MedSpa structured data',
    why: 'Schema is how machines learn who the practice is, where it is, and what it does — the entry ticket for AI answers and rich results.',
    evidence: `homepage JSON-LD types found: ${home.schema.types.length ? home.schema.types.slice(0, 5).join(', ') : 'none'}`,
    angle: 'Entity + practitioner markup package (SeenAI core deliverable).',
  });
  if (home && home.schema && !home.schema.hasFaq) fixes.push((home.faqQuestions || 0) >= 3 ? {
    title: 'Mark up the FAQ content that already exists',
    why: 'The answers are already written — wrapping them in FAQPage schema lets AI engines quote them with confidence.',
    evidence: `${home.faqQuestions} question-style headings found on the homepage, no FAQPage schema`,
    angle: 'Quick structured-data win inside the first sprint.',
  } : {
    title: 'Publish answer-shaped content (FAQ + capsules)',
    why: 'AI engines quote pages that already look like answers; FAQ markup plus short answer capsules is the highest-yield content format.',
    evidence: 'no FAQ-style content or FAQPage schema found on the homepage',
    angle: 'Content engine retainer — compounding, measurable via our panel.',
  });
  if (panel && (panel.citySampled || 0) >= CITY_CLAIM_MIN && panel.cityHits === 0) fixes.push({
    title: `Invisible in live AI answers for ${panel.city}`,
    why: 'Patients in their own market are already asking ChatGPT — we sampled it live and the practice never comes up, so competitors take those referrals.',
    evidence: `0 appearances in ${panel.citySampled} live med-spa answers for ${panel.city} (sampled ${panel.cityLastDay || 'this week'})`,
    angle: 'AI-visibility program + weekly measurement (SeenAI core).',
  });
  else if (panel && panel.sampled >= PANEL_CLAIM_MIN && panel.hits === 0) fixes.push(panelCoversMarket(home, panel) ? {
    title: 'Invisible to AI recommendation engines today',
    why: 'Patients increasingly ask ChatGPT/Perplexity first; absence means competitors take those referrals uncontested.',
    evidence: `0 appearances in ${panel.sampled} live med-spa answers we sampled across ${panel.cities} metros — including their market`,
    angle: 'AI-visibility program + weekly measurement (SeenAI core).',
  } : {
    title: 'Baseline their market in our AI-answer panel',
    why: "Our panel hasn't sampled this metro yet, so AI visibility is unmeasured — the honest first step is a baseline, not a claim.",
    evidence: `${panel.sampled} live AI answers tracked across ${panel.cities} metros; this market not yet among them`,
    angle: 'Onboarding step one: point the panel here — week two has a real number.',
  });
  for (const p of (proposals || []).slice(0, 4)) {
    if (fixes.length >= 6) break;
    fixes.push({
      title: String(p.type || 'On-page fix').slice(0, 80),
      why: String(p.rationale || p.recommendation || 'Highest expected-value on-page fix from the crawl audit.').slice(0, 200),
      evidence: `page: ${String(p.page || '/').replace(/^https?:\/\/[^/]+/, '') || '/'}`,
      angle: 'Included in the first optimization sprint.',
    });
  }
  return fixes.slice(0, 6);
}

export function upsellAnglesFor({ home, psi, panel } = {}) {
  const angles = [];
  const builder = home && home.platform && /wix|squarespace|godaddy|duda|highlevel/i.test(home.platform);
  const slow = (psi && psi.performance != null && psi.performance < 60) || (home && home.ttfbMs > 1200);
  if (builder || slow) angles.push({
    tag: 'Website rebuild', hook: `${builder ? `Built on ${home.platform}` : 'Slow measured load'} — the call-3 pitch: a fast, conversion-first rebuild that also fixes the technical findings above at the root.`,
  });
  if (home && !home.booking.provider) angles.push({
    tag: 'Booking-first redesign', hook: 'Online booking is after-hours revenue. Wire a real booking platform into the new site and every ad dollar works nights and weekends.',
  });
  if (home && home.schema && (!home.schema.hasLocalBusiness || !home.schema.hasPhysician)) angles.push({
    tag: 'Entity & practitioner markup', hook: 'Make machines confident about who runs the practice — the credential work AI engines reward and standard SEO retainers skip.',
  });
  if (!panel || panel.hits === 0) angles.push({
    tag: 'AI-visibility program', hook: 'Our always-on panel measures live AI answers. Onboarding points it at this market and reports movement weekly — a number, not a promise.',
  });
  if (!angles.length) angles.push({ tag: 'Maintenance + measurement', hook: 'The site is healthy — the pitch is protecting it and compounding AI visibility, with weekly measured proof.' });
  return angles.slice(0, 4);
}

// ---------------------------------------------------------------- deck renderer

function findingCard({ sev = 'med', title, why, evidence, angle }) {
  return `<div class="finding ${esc(sev)}"><div class="frow"><span class="sev ${esc(sev)}">${esc(sev === 'good' ? 'strength' : sev)}</span><span class="ftitle">${esc(title)}</span></div>
<div class="fbody"><div class="fcell"><div class="k">Why it matters</div><div class="v">${esc(why)}</div></div>
<div class="fcell"><div class="k">What we measured</div><div class="v">${esc(evidence)}</div></div>
${angle ? `<div class="fcell fix"><div class="k">The play</div><div class="v">${esc(angle)}</div></div>` : ''}</div></div>`;
}

const yesNo = (v, yes = 'Yes', no = 'Missing') => (v ? `<span class="pillgood">${esc(yes)}</span>` : `<span class="pillbad">${esc(no)}</span>`);

export function renderProspectDeck(d) {
  const site = d.grades.site, seo = d.grades.seo, aeo = d.grades.aeo, overall = d.grades.overall;
  const home = d.home; const psi = d.psi; const robotsAi = d.robotsAi; const panel = d.panel; const serp = d.serp;
  const dateLabel = new Date(d.generatedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  // Panel view: which visibility number (if any) the deck may claim. City-scoped live sample
  // for the lead's own metro wins; the global accrual only shows with real hits or a big
  // market-covering sample; anything less renders the honest "not sampled" callout instead.
  const pv = panel && (panel.citySampled || 0) >= CITY_CLAIM_MIN
    ? { show: true, n: panel.cityHits, of: panel.citySampled, last: panel.cityLastDay || panel.lastDay,
        scopeHtml: `live ChatGPT med-spa recommendation answers for <b>${esc(panel.city)}</b> — the lead's own market, sampled by our panel`,
        zeroLine: ' Zero is measured, not assumed — these are live answers for their own metro this week.', named: '' }
    : panel && (panel.hits > 0 || (panel.sampled >= PANEL_CLAIM_MIN && panelCoversMarket(home, panel)))
      ? { show: true, n: panel.hits, of: panel.sampled, last: panel.lastDay,
          scopeHtml: `live ChatGPT med-spa recommendation answers our panel captured across <b>${esc(String(panel.cities))}</b> metros`,
          zeroLine: ' Zero is not a typo — today, AI recommends competitors instead.',
          named: panel.hits > 0 ? ` Named in: ${esc(panel.hitCities.join(', '))}.` : '' }
      : { show: false };
  // Live proof shots (data URIs, render-time only — the stored doc keeps booleans). Base64 JPEG
  // from OUR headless capture: interpolated raw by design; captions/alt text still go through esc().
  const sd = d.shotData || {};
  const shotFig = (uri, alt, caption) => (uri
    ? `<figure class="shot"><img src="${uri}" alt="${esc(alt)}" loading="lazy" /><figcaption><span class="shottag">Live</span>${caption}</figcaption></figure>`
    : '');
  const botChips = (robotsAi && robotsAi.bots || []).map((b) =>
    `<span class="botchip ${b.allowed ? 'ok' : 'blocked'}" title="${esc(b.allowed ? 'Can read and cite the site' : 'Cannot read the site at all')}">${esc(b.agent)} <span class="st">${b.allowed ? 'allowed' : 'blocked'}</span></span>`).join('');
  const schemaChecklist = home ? [
    ['LocalBusiness / MedSpa', home.schema.hasLocalBusiness, 'Who/where/what — the entry ticket for AI answers'],
    ['Physician / practitioner', home.schema.hasPhysician, 'The credibility signal med-spa AEO turns on'],
    ['FAQPage', home.schema.hasFaq, 'Answer-shaped content AI engines quote directly'],
    ['Service / MedicalProcedure', home.schema.hasService, 'Maps treatments to the questions patients ask'],
    ['Reviews / AggregateRating', home.schema.hasRatings, 'Third-party proof machines can verify'],
  ].map(([label, ok, why]) => `<li class="${ok ? 'ok' : 'miss'}"><span class="ic">${ok ? '✓' : '✗'}</span><span><span class="cl-t">${esc(label)}</span><br/><span class="cl-w">${esc(why)}</span></span></li>`).join('') : '';
  const fixCards = d.topFixes.map((f, i) => findingCard({ sev: i === 0 ? 'crit' : i < 3 ? 'high' : 'med', ...f })).join('\n');
  const angleList = d.upsellAngles.map((a) => `<li><span class="mk">▸</span><span><b>${esc(a.tag)}:</b> ${esc(a.hook)}</span></li>`).join('');
  const issueRows = (d.auditByRule || []).slice(0, 8).map((r) =>
    `<tr><td><b>${esc(r.rule)}</b></td><td class="mono">${esc(String(r.count))}×</td><td><span class="${r.severity === 'critical' || r.severity === 'high' ? 'pillbad' : r.severity === 'medium' ? 'pillwarn' : 'pillgood'}">${esc(r.severity)}</span></td><td>${esc(String(r.recommendation || '').slice(0, 140))}</td></tr>`).join('');
  const metrics = [
    ['Server response (TTFB)', home ? `${home.ttfbMs} ms` : '—', 'live fetch, Chrome UA'],
    ['Full HTML download', home ? `${home.totalMs} ms · ${home.htmlKb} KB` : '—', 'live fetch'],
    ['Mobile performance', psi && psi.performance != null ? `${psi.performance}/100 (LCP ${psi.lcp || '—'}, CLS ${psi.cls || '—'})` : 'not measured this run', 'Google PageSpeed, mobile'],
    ['Pages crawled', d.pageCount != null ? String(d.pageCount) : '—', 'raw-HTML crawl (no JS)'],
    ['Crawl health score', d.auditScore != null ? `${d.auditScore}/100` : '—', `${d.findingsCount ?? 0} findings across the crawl`],
    ['Images missing alt', home ? `${home.imagesMissingAlt} of ${home.images}` : '—', 'homepage'],
    ['External scripts', home ? String(home.scripts) : '—', 'homepage'],
    ['Sitemap.xml', d.sitemapFound == null ? '—' : d.sitemapFound ? 'found' : 'MISSING', 'crawler discovery'],
    ['AI answers sampled', panel ? `${panel.sampled} (${panel.cities} metros, last ${panel.lastDay || '—'})` : 'panel not yet pointed at this market', 'SeenAI live ChatGPT panel'],
    ['Appearances in AI answers', panel ? String(panel.hits) : '—', 'domain or brand named'],
    ['Google SERP snapshots', serp ? `${serp.hits} of ${serp.sampled} rows mention the domain` : 'not yet sampled', 'SeenAI serp-radar accrual'],
  ].map(([k, v, m]) => `<tr><td><b>${esc(k)}</b></td><td class="mono">${esc(v)}</td><td>${esc(m)}</td></tr>`).join('');
  const tested = [
    home ? `Live browser-grade fetch of ${d.domain} — ${home.ttfbMs} ms to first byte, ${home.htmlKb} KB document, HTTP ${home.status}.` : `Live fetch of ${d.domain} did not complete this run.`,
    (sd.desktop || sd.mobile || sd.services)
      ? `Live screenshots rendered in a real headless browser (desktop ${sd.desktop ? '✓' : '—'} · mobile ${sd.mobile ? '✓' : '—'} · services ${sd.services ? '✓' : '—'}) — embedded below, captured this run.`
      : (home ? 'Screenshots unavailable this run — the site blocked headless rendering (all other measurements unaffected).' : null),
    sd.aiAnswer ? `One live ChatGPT answer for the lead's own market captured on screen during this audit — embedded in Section 3, unedited.` : null,
    `Raw-HTML crawl audit of ${d.pageCount ?? '—'} pages — the same non-JavaScript view Google and AI crawlers start from.`,
    robotsAi ? `robots.txt evaluated as ${AI_AGENTS.join(', ')} — exactly what each AI engine is allowed to read.` : 'robots.txt could not be fetched this run.',
    home ? 'Every JSON-LD block on the homepage parsed byte-for-byte.' : null,
    psi ? 'Google PageSpeed (mobile) run live during this audit.' : 'Google PageSpeed was unreachable during this run — speed grades use our direct measurements only.',
    panel ? `${panel.sampled} live ChatGPT med-spa answers from our always-on panel scanned for ${d.brand}.` : 'Our live AI-answer panel has not sampled this market yet — pointing it here is onboarding step one.',
  ].filter(Boolean).map((s) => `<li><span class="mk">▸</span><span>${esc(s)}</span></li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>Website · SEO · AEO Audit — ${esc(d.brand)}</title>
<style>
  /* Hallmark · pre-emit critique: P4 H5 E4 S5 R4 V4
   * Hallmark · macrostructure: Long Document (report) · tone: technical-luxury dark · anchor hue: periwinkle 265°
   * theme: custom (brand-locked: SeenAI periwinkle #B4CAFF on blue-black #0A0A0F, system stack)
   * studied: no · enrichment: live measurement screenshots only (real captures, hairline figures — no fake chrome) */
  :root{--paper:#0A0A0F;--panel:#11111D;--panel-2:#161627;--wash:rgba(180,202,255,.06);
  --ink:#FAFAFA;--text:#C9CBDA;--soft:#9FA3B8;--muted:#6E7288;
  --accent:#B4CAFF;--accent-dim:rgba(180,202,255,.55);--line:rgba(180,202,255,.14);--line-soft:rgba(180,202,255,.08);
  --good:#7EF0B2;--warn:#FFD98F;--bad:#FF8FA3;--crit:#FF8FA3;
  --glow:0 0 18px rgba(180,202,255,.28);
  --r-lg:18px;--r-md:14px;--r-sm:9px;
  --font-sans:-apple-system,"SF Pro Display","SF Pro Text",BlinkMacSystemFont,"Helvetica Neue","Segoe UI",Helvetica,Arial,sans-serif}
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  html,body{overflow-x:clip}
  body{background:var(--paper);color:var(--text);font-family:var(--font-sans);-webkit-font-smoothing:antialiased;line-height:1.55;letter-spacing:-.01em}
  .layout{position:relative;z-index:1;display:grid;grid-template-columns:264px minmax(0,1fr);max-width:1280px;margin:0 auto}
  aside{position:sticky;top:0;height:100vh;overflow-y:auto;padding:30px 20px 40px;border-right:1px solid var(--line-soft);background:var(--paper)}
  .brand{display:flex;align-items:center;gap:9px;font-weight:700;font-size:17px;color:var(--accent)}
  .brand .dot{width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:var(--glow)}
  .brand-sub{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin:4px 0 22px}
  .toc a{display:block;color:var(--soft);text-decoration:none;font-size:13.5px;padding:7px 12px;border-radius:var(--r-sm)}
  .toc a:hover{color:var(--ink);background:var(--wash)}
  .toc a.sec{font-weight:700;color:var(--ink);margin-top:14px;font-size:12.5px;letter-spacing:.05em;text-transform:uppercase}
  .dlbtn{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:24px;padding:12px 16px;border-radius:12px;background:var(--accent);color:var(--paper);font-weight:700;font-size:14px;text-decoration:none;border:none;cursor:pointer;width:100%}
  main{padding:0 clamp(20px,4vw,64px) 110px;min-width:0}
  .hero{position:relative;margin:0 0 8px;padding:56px clamp(24px,3.4vw,50px) 44px;border-radius:0 0 26px 26px;overflow:hidden;
    background:radial-gradient(1200px 500px at 85% -10%,rgba(180,202,255,.16),transparent 60%),radial-gradient(700px 420px at -10% 110%,rgba(180,202,255,.09),transparent 60%),var(--panel)}
  .hero-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:clamp(20px,3vw,42px);align-items:center}
  .eyebrow{display:inline-flex;align-items:center;gap:10px;font-size:12px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--accent-dim)}
  .eyebrow::before{content:"";width:24px;height:1px;background:var(--accent-dim)}
  h1{font-size:clamp(28px,4vw,46px);font-weight:800;line-height:1.06;letter-spacing:-.03em;margin:16px 0 12px;color:var(--ink);overflow-wrap:anywhere;min-width:0;text-shadow:0 0 34px rgba(180,202,255,.18)}
  .hero p{font-size:clamp(15px,1.4vw,17px);color:var(--soft);max-width:60ch}
  .meta-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
  .chip{font-size:12.5px;color:var(--text);border:1px solid var(--line);background:var(--wash);padding:6px 13px;border-radius:999px}
  .startline{margin-top:20px;padding:13px 16px;border-radius:var(--r-md);background:var(--wash);border:1px solid var(--line);font-size:14px;color:var(--text)}
  .startline b{color:var(--accent)}
  .heroshot{border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;background:var(--panel-2);box-shadow:0 18px 48px rgba(0,0,0,.5),var(--glow)}
  .heroshot img{display:block;width:100%;max-width:100%}
  .heroshot figcaption{padding:9px 13px;font-size:12px;color:var(--soft);border-top:1px solid var(--line-soft)}
  section{padding:42px 0 6px;scroll-margin-top:20px}
  h2.sh{font-size:12.5px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
  h3.bh{font-size:clamp(22px,2.4vw,30px);font-weight:800;letter-spacing:-.025em;margin-bottom:8px;line-height:1.12;color:var(--ink);overflow-wrap:anywhere}
  .sectlead{color:var(--soft);font-size:15px;max-width:72ch;margin-bottom:6px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:12px;margin-top:14px}
  .tile{border:1px solid var(--line);border-radius:var(--r-md);padding:15px 16px;background:var(--panel)}
  .tile .k{font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);margin-bottom:7px}
  .tile .v{font-size:19px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
  .tile .r{font-size:12px;margin-top:5px}
  .botchips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .botchip{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;padding:7px 12px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--text)}
  .botchip .st{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  .botchip.ok .st{color:var(--good)}.botchip.blocked{border-color:rgba(255,143,163,.5)}.botchip.blocked .st{color:var(--bad)}
  .checklist{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:12px;list-style:none}
  .checklist li{display:flex;gap:10px;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--panel);font-size:13.5px;line-height:1.45}
  .checklist .ic{flex:none;font-weight:800}
  .checklist li.ok .ic{color:var(--good)}.checklist li.miss .ic{color:var(--bad)}
  .checklist .cl-t{color:var(--ink);font-weight:700}.checklist .cl-w{color:var(--soft);font-size:12.5px;margin-top:2px}
  .finding{border:1px solid var(--line);border-radius:var(--r-lg);padding:20px 22px;margin-top:14px;background:var(--panel)}
  .finding.high{border-left:3px solid var(--bad)}.finding.crit{border-left:3px solid var(--crit)}
  .finding.med{border-left:3px solid var(--warn)}.finding.good{border-left:3px solid var(--good)}
  .frow{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:4px}
  .sev{font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:4px 10px;border-radius:7px;background:var(--wash)}
  .sev.crit,.sev.high{color:var(--bad)}.sev.med{color:var(--warn)}.sev.good{color:var(--good)}
  .ftitle{font-size:16.5px;font-weight:700;color:var(--ink)}
  .fbody{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px}
  .fcell .k{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:4px}
  .fcell .v{font-size:13.5px;color:var(--text);line-height:1.5}
  .fix{grid-column:1/-1;border-top:1px dashed var(--line);padding-top:10px}
  .fix .k{color:var(--good)}
  figure.shot{margin:16px 0 4px;border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;background:var(--panel-2);box-shadow:0 12px 34px rgba(0,0,0,.45)}
  figure.shot img{display:block;width:100%;max-width:100%}
  figure.shot figcaption{padding:10px 14px;font-size:12.5px;color:var(--soft);border-top:1px solid var(--line-soft);background:var(--panel)}
  figure.shot figcaption b{color:var(--accent)}
  figure.shot.ai{box-shadow:0 12px 34px rgba(0,0,0,.45),var(--glow);border-color:rgba(180,202,255,.35)}
  .shottag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--paper);background:var(--accent);border-radius:6px;padding:2px 8px;margin-right:8px}
  .shotgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;align-items:start;margin-top:16px}
  .tw{overflow-x:auto;margin-top:12px}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  th,td{text-align:left;padding:10px 13px;border-bottom:1px solid var(--line-soft);vertical-align:top}
  th{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:700}
  td b{color:var(--ink)}.mono{font-variant-numeric:tabular-nums;white-space:nowrap}
  .pillbad{color:var(--bad);font-weight:700}.pillwarn{color:var(--warn);font-weight:700}.pillgood{color:var(--good);font-weight:700}
  .callout{border:1px solid var(--line);border-radius:var(--r-md);padding:16px 20px;margin-top:16px;background:var(--wash)}
  .callout .k{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin-bottom:5px}
  .callout p{font-size:14px}
  ul.list{list-style:none;margin-top:10px;display:flex;flex-direction:column;gap:8px}
  ul.list li{display:flex;gap:10px;font-size:13.5px;line-height:1.5}
  ul.list li .mk{color:var(--accent);flex:none}
  .bignum{display:flex;gap:18px;align-items:baseline;margin-top:14px;flex-wrap:wrap}
  .bignum .n{font-size:56px;font-weight:800;letter-spacing:-.04em;color:var(--ink);text-shadow:0 0 26px rgba(180,202,255,.22)}
  .bignum .d{font-size:14px;color:var(--soft);max-width:46ch}
  .roadmap{border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;margin-top:14px}
  .rm{display:grid;grid-template-columns:96px minmax(0,1fr);border-bottom:1px solid var(--line-soft)}
  .rm:last-child{border-bottom:none}
  .rm .ph{padding:16px;font-weight:800;background:var(--wash);font-size:13.5px;color:var(--accent);display:flex;align-items:center}
  .rm .it{padding:14px 18px;background:var(--panel)}
  .rm .it ul{list-style:none;display:flex;flex-direction:column;gap:6px}
  .rm .it li{font-size:13.5px;display:flex;gap:8px}.rm .it li .mk{color:var(--accent)}
  footer{margin-top:50px;padding-top:22px;border-top:1px solid var(--line-soft);color:var(--muted);font-size:12.5px}
  .topbar{display:none}
  @media(max-width:920px){.layout{grid-template-columns:1fr}aside{display:none}
    .topbar{display:flex;position:sticky;top:0;z-index:5;justify-content:space-between;align-items:center;padding:11px 16px;background:var(--paper);border-bottom:1px solid var(--line-soft)}
    .topbar .dlbtn{margin:0;padding:9px 14px;width:auto}main{padding:0 16px 80px}.hero{border-radius:0 0 18px 18px}
    .hero-grid{grid-template-columns:1fr}}
  @media(max-width:720px){.fbody{grid-template-columns:1fr}.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
  /* Print = the PDF the founders hand over: light paper, same tokens re-anchored. */
  @media print{
    :root{--paper:#fff;--panel:#fff;--panel-2:#fff;--wash:#f2f4fb;--ink:#14141c;--text:#2e2e3c;--soft:#5a5e70;
    --muted:#8b8fa3;--accent:#4a5ec4;--accent-dim:#4a5ec4;--line:#d9ddef;--line-soft:#e6e9f5;
    --good:#177a52;--warn:#9a6206;--bad:#c22646;--crit:#c22646;--glow:none}
    aside,.topbar,.dlbtn{display:none!important}.layout{grid-template-columns:1fr}
    .hero{background:var(--wash);border-radius:0}h1{text-shadow:none}
    .heroshot,figure.shot{box-shadow:none}
  }
</style>
</head>
<body>
<div class="topbar"><div class="brand"><span class="dot"></span>SeenAI</div><button class="dlbtn" onclick="window.print()">⤓ PDF</button></div>
<div class="layout">
<aside>
  <div class="brand"><span class="dot"></span>SeenAI</div>
  <div class="brand-sub">Audit · ${esc(dateLabel)}</div>
  <nav class="toc">
    <a class="sec" href="#verdict">Verdict</a>
    <a href="#method">How we tested</a>
    <a class="sec" href="#website">1 · Website &amp; Tech</a>
    <a class="sec" href="#seo">2 · SEO</a>
    <a class="sec" href="#aeo">3 · AI Visibility</a>
    <a class="sec" href="#fixes">4 · Top Fixes</a>
    <a href="#roadmap">Roadmap</a>
    <a class="sec" href="#appendix">Appendix</a>
  </nav>
  <button class="dlbtn" onclick="window.print()">⤓ Download PDF</button>
</aside>
<main>
<div class="hero" id="verdict">
  <div class="hero-grid">
    <div>
      <span class="eyebrow">SeenAI · Website × SEO × AEO Audit</span>
      <h1>${esc(d.verdict.head)}</h1>
      <p>${esc(d.verdict.sub)}</p>
      <div class="meta-row">
        <span class="chip">${esc(d.domain)}</span>
        <span class="chip">Measured live · ${esc(dateLabel)}</span>
        <span class="chip">Prepared for ${esc(d.brand)}</span>
        <span class="chip">By SeenAI — Shubh Gajjar &amp; An Shah</span>
      </div>
      <div class="startline"><b>Where we'd start:</b> ${esc(d.overallLine)}</div>
    </div>
    ${sd.desktop ? `<figure class="heroshot"><img src="${sd.desktop}" alt="${esc(d.domain)} homepage — desktop, captured live" loading="eager" /><figcaption><span class="shottag">Live</span>${esc(d.domain)} — captured during this audit · ${esc(dateLabel)}</figcaption></figure>` : ''}
  </div>
</div>

<section id="method">
  <h2 class="sh">Methodology</h2><h3 class="bh">How we tested</h3>
  <p class="sectlead">Every number in this report was captured directly from the live site and our own always-on measurement panels — not estimated.</p>
  <ul class="list">${tested}</ul>
</section>

<section id="website">
  <h2 class="sh">Section 1</h2><h3 class="bh">Website &amp; Technical Health</h3>
  ${home ? `<div class="tiles">
    <div class="tile"><div class="k">Server response</div><div class="v">${esc(String(home.ttfbMs))} ms</div><div class="r">${home.ttfbMs <= 500 ? '<span class="pillgood">fast</span>' : home.ttfbMs <= 1200 ? '<span class="pillwarn">acceptable</span>' : '<span class="pillbad">slow — patients feel this</span>'}</div></div>
    <div class="tile"><div class="k">Mobile performance</div><div class="v">${esc(psi && psi.performance != null ? `${psi.performance}/100` : '—')}</div><div class="r">${psi && psi.performance != null ? (psi.performance >= 80 ? '<span class="pillgood">strong</span>' : psi.performance >= 55 ? '<span class="pillwarn">needs work</span>' : '<span class="pillbad">losing mobile patients</span>') : 'not measured this run'}</div></div>
    <div class="tile"><div class="k">HTML weight</div><div class="v">${esc(String(home.htmlKb))} KB</div><div class="r">${home.htmlKb <= 600 ? '<span class="pillgood">lean</span>' : '<span class="pillwarn">heavy</span>'}</div></div>
    <div class="tile"><div class="k">Mobile viewport</div><div class="v">${home.viewport ? 'present' : 'missing'}</div><div class="r">${yesNo(home.viewport, 'mobile-ready', 'not mobile-configured')}</div></div>
    <div class="tile"><div class="k">HTTPS</div><div class="v">${home.https ? 'yes' : 'no'}</div><div class="r">${yesNo(home.https, 'secure', 'insecure')}</div></div>
    <div class="tile"><div class="k">Platform</div><div class="v">${esc(home.platform || 'custom')}</div><div class="r">${esc(home.platform && /wix|squarespace|godaddy|duda/i.test(home.platform) ? 'site-builder ceiling on speed & SEO control' : 'no builder ceiling detected')}</div></div>
  </div>` : '<div class="callout"><div class="k">Not measured</div><p>The homepage did not respond during this run — that is itself a critical finding if it repeats.</p></div>'}
  ${sd.mobile || sd.services ? `<div class="shotgrid">
    ${shotFig(sd.mobile, `${d.domain} homepage — mobile`, `mobile view · what a phone patient sees first · ${esc(dateLabel)}`)}
    ${shotFig(sd.services, `${d.domain} services page — live capture`, `services page · what AI crawlers read treatments from · ${esc(dateLabel)}`)}
  </div>` : ''}
  <h2 class="sh" style="margin-top:26px">AI-bot access</h2>
  ${robotsAi ? `<div class="botchips">${botChips}</div>` : '<div class="callout"><div class="k">Not measured</div><p>robots.txt could not be fetched this run.</p></div>'}
</section>

<section id="seo">
  <h2 class="sh">Section 2</h2><h3 class="bh">Search Engine Optimization</h3>
  ${home ? `<div class="tw"><table><tr><th>Homepage element</th><th>Found</th></tr>
    <tr><td><b>&lt;title&gt;</b></td><td>${home.title ? esc(home.title) : '<span class="pillbad">missing</span>'}</td></tr>
    <tr><td><b>Meta description</b></td><td>${home.metaDescription ? esc(home.metaDescription.slice(0, 160)) : '<span class="pillbad">missing</span>'}</td></tr>
    <tr><td><b>H1</b></td><td>${home.h1 ? esc(home.h1) : '<span class="pillbad">missing</span>'}</td></tr>
    <tr><td><b>Sitemap.xml</b></td><td>${d.sitemapFound ? '<span class="pillgood">found</span>' : '<span class="pillbad">missing — crawlers are guessing</span>'}</td></tr>
    <tr><td><b>NAP on site</b></td><td>${home.schema.nap.address ? esc(`${home.schema.nap.name || ''} · ${home.schema.nap.address}${home.schema.nap.telephone ? ' · ' + home.schema.nap.telephone : ''}`) : (home.telLink ? 'phone link only — no structured address' : '<span class="pillbad">no structured name/address/phone found</span>')}</td></tr>
  </table></div>` : ''}
  ${issueRows ? `<h2 class="sh" style="margin-top:26px">Crawl findings (${esc(String(d.pageCount ?? 0))} pages)</h2>
  <div class="tw"><table><tr><th>Rule</th><th>Count</th><th>Severity</th><th>Fix</th></tr>${issueRows}</table></div>` : ''}
</section>

<section id="aeo">
  <h2 class="sh">Section 3</h2><h3 class="bh">AI Visibility (AEO)</h3>
  <p class="sectlead">Patients now ask ChatGPT and Perplexity for med-spa recommendations before they ever type into Google. This section measures whether the machines can even see ${esc(d.brand)} — and whether they do.</p>
  ${pv.show ? `<div class="bignum"><span class="n">${esc(String(pv.n))}<span style="font-size:26px;color:var(--muted)">/${esc(String(pv.of))}</span></span>
  <span class="d">appearances in <b>${esc(String(pv.of))}</b> ${pv.scopeHtml} (latest: ${esc(pv.last || '—')}).${pv.n === 0 ? pv.zeroLine : pv.named}</span></div>` :
  `<div class="callout"><div class="k">Panel status</div><p>Our always-on AI-answer panel hasn't sampled ${esc(d.brand)}'s metro yet, so we make no claim about current AI visibility — we measure, we don't guess. Pointing the panel at this market is onboarding step one; from then on it's a weekly measured number.</p></div>`}
  ${sd.aiAnswer ? `<figure class="shot ai"><img src="${sd.aiAnswer}" alt="Live ChatGPT answer for ${esc(String(sd.aiPrompt || 'the market'))}" loading="lazy" /><figcaption><span class="shottag">Live</span><b>&ldquo;${esc(String(sd.aiPrompt || ''))}&rdquo;</b> — asked in ChatGPT during this audit · ${esc(dateLabel)} · ${sd.aiNamed ? `${esc(d.brand)} is already named — the play is compounding that position before competitors close the gap.` : `${esc(d.brand)} never comes up. This screen is what patients in the market are shown instead.`}</figcaption></figure>` : ''}
  ${serp && (serp.hits > 0 || serp.sampled >= PANEL_CLAIM_MIN) ? `<p class="sectlead" style="margin-top:10px">Google check: the domain appears in <b>${esc(String(serp.hits))}</b> of <b>${esc(String(serp.sampled))}</b> tracked local-SERP snapshots.</p>` : ''}
  <h2 class="sh" style="margin-top:26px">Schema deep-dive</h2>
  ${home ? `<ul class="checklist">${schemaChecklist}</ul>` : ''}
  ${home ? `<div class="callout"><div class="k">Entity footprint</div><p>${esc(home.socials.length ? `Linked profiles found: ${home.socials.join(', ')}.` : 'No social/profile links detected on the homepage.')} ${esc(home.schema.sameAs.length ? `sameAs markup: ${home.schema.sameAs.length} profiles.` : 'No sameAs markup — machines can\'t connect the practice to its profiles.')}</p></div>` : ''}
  ${aeo && aeo.passes && aeo.passes.length ? `<div class="callout"><div class="k">Already working for ${esc(d.brand)}</div><p>${esc(aeo.passes.join(' · '))}. We grade what we measure — the gaps above are the whole honest list.</p></div>` : ''}
</section>

<section id="fixes">
  <h2 class="sh">Section 4</h2><h3 class="bh">Top fixes — in the order they pay</h3>
  ${fixCards}
  <h2 class="sh" style="margin-top:28px">Where SeenAI takes it</h2>
  <ul class="list">${angleList}</ul>
  <div class="roadmap" id="roadmap">
    <div class="rm"><div class="ph">Week 1</div><div class="it"><ul>${d.roadmap.now.map((x) => `<li><span class="mk">▸</span><span>${esc(x)}</span></li>`).join('')}</ul></div></div>
    <div class="rm"><div class="ph">30 days</div><div class="it"><ul>${d.roadmap.d30.map((x) => `<li><span class="mk">▸</span><span>${esc(x)}</span></li>`).join('')}</ul></div></div>
    <div class="rm"><div class="ph">90 days</div><div class="it"><ul>${d.roadmap.d90.map((x) => `<li><span class="mk">▸</span><span>${esc(x)}</span></li>`).join('')}</ul></div></div>
  </div>
</section>

<section id="appendix">
  <h2 class="sh">Appendix</h2><h3 class="bh">Measured metrics</h3>
  <div class="tw"><table><tr><th>Metric</th><th>Value</th><th>Method</th></tr>${metrics}</table></div>
  <footer>Generated ${esc(new Date(d.generatedAt).toUTCString())} by the SeenAI audit engine · measured live on ${esc(d.domain)} · This link is private to ${esc(d.brand)} and SeenAI.</footer>
</section>
</main>
</div>
</body>
</html>`;
}

/** The 3–4 sharpest measured facts for the Slack call-ammo card (closer-readable, ≤60 chars each). */
export function ammoFactsFor(deck) {
  const facts = [];
  const home = deck.home; const psi = deck.psi; const panel = deck.panel;
  if (psi && psi.performance != null) facts.push(`📱 mobile speed ${psi.performance}/100`);
  else if (home) facts.push(`⚡ ${home.ttfbMs}ms to first byte${home.ttfbMs > 1200 ? ' (SLOW)' : ''}`);
  if (home) facts.push(`📅 booking: ${home.booking.provider || 'NONE detected'}`);
  const blocked = ((deck.robotsAi && deck.robotsAi.bots) || []).filter((b) => !b.allowed && ['GPTBot', 'ClaudeBot', 'PerplexityBot'].includes(b.agent));
  if (blocked.length) facts.push(`🤖 ${blocked.map((b) => b.agent).join('+')} BLOCKED`);
  // Claim-worthy panel data only: the lead's own-metro live sample first, else global
  // positive hits / big covering sample. A "0/19" one-liner is a prop, not ammo.
  if (panel && (panel.citySampled || 0) >= CITY_CLAIM_MIN) {
    facts.push(`👁 AI answers ${panel.city}: ${panel.cityHits}/${panel.citySampled} (live)`);
  } else if (panel && (panel.hits > 0 || (panel.sampled >= PANEL_CLAIM_MIN && panelCoversMarket(home, panel)))) {
    facts.push(`👁 AI answers: named in ${panel.hits}/${panel.sampled}`);
  }
  return facts.slice(0, 4);
}

// ---------------------------------------------------------------- orchestrator

/** Default AI-shot dependency: dynamic import so tests (and machines without the capture
 *  stack) never pay for it — the module's own gates all fail soft to null anyway. */
async function defaultAiShotCapture(args) {
  try {
    const { captureAiAnswerShot } = await import('./measure/precall-ai-shot.mjs');
    return await captureAiAnswerShot(args);
  } catch { return null; }
}

/**
 * Build the full prospect audit: probes (parallel, fail-soft) → grades → verdict →
 * fixes/angles → rendered deck. Returns the store document (deck HTML inside).
 */
export async function buildProspectAudit(cfg, { audit = null, proposals = [], fetchImpl = fetch, captureShots = probeShots, aiShotCapture = defaultAiShotCapture, panelSampler = null, root = ROOT, now = () => new Date(), log = () => {} } = {}) {
  const domain = cfg.domain;
  const baseUrl = cfg.baseUrl || `https://${domain}/`;
  const [home, robotsAi, psi] = await Promise.all([
    probeHome(baseUrl, fetchImpl, log),
    probeRobotsAi(baseUrl, fetchImpl, log),
    probePsi(domain, fetchImpl, log),
  ]);
  // Real screenshots (Shubh directive #2): desktop + mobile homepage, plus the services page
  // when we found one. After probeHome (it supplies the services URL).
  let shots = null;
  try { shots = await captureShots({ baseUrl, servicesUrl: (home && home.servicesUrl) || null, log }); } catch { shots = null; }
  const brand = (home && home.brandGuess) || cfg.brand || domain;
  // The lead's own market, "City ST" (matches the query bank's city format). Feeds the
  // city-scoped panel stats and, when a sampler is provided (the runner's on-demand
  // capture burst — Shubh 2026-07-24 "check their city and run that first"), a live
  // measurement of THEIR metro before the deck is graded. Fail-soft: sampler errors
  // leave the accrual as-is and the deck falls back to the honest unmeasured callout.
  const leadCity = (home && home.cityGuess) || null;
  if (leadCity && typeof panelSampler === 'function') {
    try { await panelSampler({ city: leadCity, domain, brand, log }); }
    catch (e) { log(`  prospect: on-demand market sample failed (${String(e && e.message || e).slice(0, 100)}) — continuing without it`); }
  }
  let panel = null, serp = null;
  try { panel = panelLookup({ domain, brand, city: leadCity, root }); } catch { panel = null; }
  try { serp = serpLookup({ domain, root }); } catch { serp = null; }

  // The live ChatGPT-answer proof shot ("Shubh 2026-07-31: add more screenshots") — the
  // single sharpest visual an AEO deck can carry. Every gate inside fails soft to null,
  // and the module refuses to shoot from anything but the verified logged-in capture Chrome.
  let aiShot = null;
  if (leadCity && aiShotCapture) {
    try { aiShot = await aiShotCapture({ city: leadCity, brand, domain, root, log }); } catch { aiShot = null; }
  }
  if (aiShot && aiShot.dataUri) {
    if (!shots) shots = { desktop: null, mobile: null, services: null };
    shots.aiAnswer = aiShot.dataUri;
    shots.aiPrompt = aiShot.prompt;
    shots.aiNamed = !!aiShot.named;
    // Combined budget across ALL FOUR shots — drop order: services → mobile → aiAnswer; desktop last.
    const size = (u) => (u ? u.length : 0);
    const tot = () => size(shots.desktop) + size(shots.mobile) + size(shots.services) + size(shots.aiAnswer);
    const CAP = 430 * 1024 * 1.4; // data-URI overhead vs raw caps, same margin probeShots uses
    if (tot() > CAP) shots.services = null;
    if (tot() > CAP) shots.mobile = null;
    if (tot() > CAP) { shots.aiAnswer = null; shots.aiPrompt = null; shots.aiNamed = null; }
  }

  const site = gradeWebsite(home, psi);
  const seo = gradeSeo(audit, home);
  const aeo = gradeAeo({ home, robotsAi, panel });
  const parts = [site.score, seo.score, aeo.score].filter((x) => x != null);
  const overall = parts.length ? Math.round((site.score ?? 60) * 0.3 + (seo.score ?? 60) * 0.3 + (aeo.score ?? 60) * 0.4) : 50;
  const verdict = verdictFor({ brand, domain, site, seo, aeo });
  const topFixes = topFixesFor({ home, robotsAi, panel, audit, proposals });
  const upsellAngles = upsellAnglesFor({ home, psi, panel });
  // Rendered after the hero's "Where we'd start:" label — no lead-in of its own, and the
  // section pointer tracks the v2 numbering (Top Fixes = Section 4 since booking/scorecard left).
  const overallLine = topFixes.length
    ? `${topFixes[0].title} — the full order-of-operations is in Section 4.`
    : 'The site audits clean on what we measured — the play is protection plus compounding AI visibility.';
  const roadmap = {
    now: topFixes.slice(0, 2).map((f) => f.title).concat(['Point the SeenAI panel at this market (baseline AI visibility)']),
    d30: topFixes.slice(2, 4).map((f) => f.title).concat(['Entity + practitioner markup live', 'First answer-shaped content published']),
    d90: ['Weekly measured AI-visibility movement', 'Authority placements in the sources AI engines actually cite', 'Booking-funnel conversion review with real traffic data'],
  };

  const doc = {
    version: 1,
    slug: String(domain).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60),
    domain, brand,
    token: randomBytes(12).toString('base64url'),
    generatedAt: now().toISOString(),
    grades: { site, seo, aeo, overall },
    verdict, overallLine,
    home, psi, robotsAi, panel, serp,
    auditScore: audit ? audit.score : null,
    auditByRule: audit ? (audit.byRule || []).slice(0, 10) : [],
    findingsCount: audit && audit.allFindings ? audit.allFindings.length : null,
    pageCount: audit ? audit.pageCount : null,
    sitemapFound: audit ? audit.sitemapFound : null,
    topFixes, upsellAngles, roadmap,
  };
  // Shot data URIs ride ONLY inside the rendered HTML (self-contained, printable); the stored
  // doc keeps booleans so the payload isn't doubled and the deck JSON stays under store limits.
  doc.shots = shots ? { desktop: !!shots.desktop, mobile: !!shots.mobile, services: !!shots.services, aiAnswer: !!shots.aiAnswer } : null;
  doc.html = renderProspectDeck({ ...doc, shotData: shots || null });
  return doc;
}
