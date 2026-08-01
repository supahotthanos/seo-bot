// seo-bot · local/gbp-public — capture the PUBLIC Google Business surface (the brand
// knowledge panel on a Google SERP) for the client + configured competitors, without
// any GBP API/OAuth. This is the founders+AI lane's data source for the local factor
// model: primary category shown, rating, review count, address/phone shown, hours shown.
//
// What the public surface CANNOT give (and we never fake): GBP Insights (impressions/
// calls/directions), review DATES at volume (velocity math needs dates — stays 'unknown'
// until supplied), claim/verification status. Missing ⇒ status 'no-panel'/'unknown',
// never a fabricated zero (measurement honesty; blocked ≠ zero).
//
// Capture posture matches serp-radar (the Google lane standard): injected fetcher in
// tests; live path is a stealth browser (ignoreCdp — NEVER the ChatGPT CDP Chrome),
// human pacing between queries, block-aware (a /sorry/ or consent wall ⇒ status
// 'blocked', the row is EXCLUDED), hard per-run cap. Brand queries carry the city in
// the query text, so no uule pin is needed.

import { launchBrowser } from '../measure/browser.mjs';
import { humanDelayMs } from '../measure/capture-governor.mjs';

const MAX_PANELS_PER_RUN = 6; // client + ≤5 competitors — hard cap, this lane stays tiny

const S = (v) => (typeof v === 'string' ? v.trim() : '');
const stripTags = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** PURE: is this SERP HTML a block/consent wall? (string twin of serp-radar's live check) */
export function blockedSerpHtml(html = '') {
  const t = String(html);
  return /unusual traffic|detected unusual|are you a robot|verify you.?re human|before you continue to google|\/sorry\/|id="recaptcha"|captcha-form|challenges\.cloudflare/i.test(t);
}

const num = (s) => {
  const n = Number(String(s ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * PURE: extract the local knowledge panel from a Google SERP HTML string.
 * Anchored on data-attrid attributes (the most durable panel markers) with aria-label
 * and text-pattern fallbacks. Returns { found:false } when no panel signature exists —
 * callers treat that as "GBP possibly unclaimed / brand ambiguous", never as zeros.
 */
export function parseKnowledgePanel(html = '') {
  const h = String(html || '');
  if (h.length < 200) return { found: false, reason: 'empty-html' };

  // Subtitle: `<div data-attrid="subtitle">Medical spa in Toronto, Ontario</div>` —
  // the category-as-shown line, the closest public proxy for the GBP primary category.
  const subtitle = stripTags(h.match(/data-attrid="subtitle"[^>]*>([\s\S]{0,240}?)<\//i)?.[1] || '');
  const catMatch = subtitle.match(/^(.+?)\s+in\s+(.+)$/i);

  // Rating: aria-label "Rated 4.8 out of 5" (panel) or "4.8 stars".
  const rating = num(h.match(/aria-label="Rated\s+([\d.]+)\s+out of 5/i)?.[1] ?? h.match(/aria-label="([\d.]+)\s+stars?/i)?.[1]);

  // Review count: "1,234 Google reviews" (anchor text) or aria-label "1,234 reviews".
  const reviewCount = num(h.match(/([\d,]+)\s+Google reviews/i)?.[1] ?? h.match(/aria-label="([\d,]+)\s+reviews?/i)?.[1]);

  const address = stripTags(h.match(/data-attrid="kc:\/location\/location:address"[^>]*>([\s\S]{0,300}?)<\/(?:div|span)>/i)?.[1] || '').replace(/^Address:\s*/i, '');
  const phone = stripTags(h.match(/data-attrid="kc:\/collection\/knowledge_panels\/has_phone:phone"[^>]*>([\s\S]{0,160}?)<\/(?:div|span)>/i)?.[1] || '').replace(/^Phone:\s*/i, '');
  const hoursShown = /data-attrid="kc:\/location\/location:hours"|data-attrid="kc:\/local:business hours"/i.test(h);
  const name = stripTags(h.match(/data-attrid="title"[^>]*>([\s\S]{0,160}?)<\//i)?.[1] || '');

  const found = Boolean(name || subtitle || (rating !== null && reviewCount !== null && address));
  if (!found) return { found: false, reason: 'no-panel-signature' };
  return {
    found: true,
    name: name || null,
    subtitle: subtitle || null,
    categoryShown: catMatch ? catMatch[1].trim() : null, // e.g. "Medical spa"
    cityShown: catMatch ? catMatch[2].trim() : null,
    rating,
    reviewCount,
    address: address || null,
    phone: phone || null,
    hoursShown,
  };
}

/** PURE: the entity list a capture run covers — client first, then structured competitors. */
export function buildPanelSpecs(cfg = {}) {
  const city = S(cfg.deepAudit?.city) || S(cfg.locations?.[0]?.nap?.city);
  const specs = [{ role: 'client', brand: S(cfg.brand) || S(cfg.domain), domain: S(cfg.domain) }];
  for (const c of (Array.isArray(cfg.deepAudit?.competitors) ? cfg.deepAudit.competitors : [])) {
    const brand = S(c?.name);
    if (brand) specs.push({ role: 'competitor', brand, domain: S(c?.domain) || null });
  }
  return specs.slice(0, MAX_PANELS_PER_RUN).map((s) => ({
    ...s,
    query: city ? `${s.brand} ${city}` : s.brand,
    city: city || null,
  }));
}

const serpUrl = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=us&pws=0`;

/**
 * Capture the public panel for every spec. fetchHtml is injected in tests
 * (async (url, spec) => html). Live default drives a stealth browser, paced,
 * block-aware; two consecutive blocks trip the breaker (same contract as the
 * other capture lanes — stealth reduces ban odds, it does not license volume).
 */
export async function captureGbpPublic(cfg = {}, { fetchHtml = null, log = () => {}, pauseMs = null } = {}) {
  const specs = buildPanelSpecs(cfg);
  const ranAt = new Date().toISOString();
  if (!specs.length || !specs[0].brand) return { ranAt, entities: [], blockedCount: 0, note: 'no brand configured (fail closed)' };

  const entities = [];
  let blockedStreak = 0, blockedCount = 0;
  const live = !fetchHtml;
  let browserHandle = null, page = null;

  const fetchImpl = fetchHtml || (async (url) => {
    if (!page) {
      browserHandle = await launchBrowser({ headless: false, stealth: true, ignoreCdp: true });
      const handle = browserHandle.context || browserHandle.browser;
      if (!handle) throw new Error(`no browser driver (${browserHandle.status})`);
      const ctx = browserHandle.context || await browserHandle.browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });
      page = (browserHandle.context && ctx.pages()[0]) || await ctx.newPage();
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500 + Math.random() * 1500);
    return await page.content();
  });

  try {
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      let row;
      try {
        const html = await fetchImpl(serpUrl(spec.query), spec);
        if (blockedSerpHtml(html)) {
          blockedStreak++; blockedCount++;
          row = { ...spec, status: 'blocked', panel: null };
        } else {
          blockedStreak = 0;
          const panel = parseKnowledgePanel(html);
          row = panel.found ? { ...spec, status: 'ok', panel } : { ...spec, status: 'no-panel', panel: null, reason: panel.reason };
        }
      } catch (e) {
        row = { ...spec, status: 'error', panel: null, error: String(e.message || e).slice(0, 160) };
      }
      entities.push(row);
      log(`  gbp-public: ${spec.role} "${spec.brand}" → ${row.status}`);
      if (blockedStreak >= 2) { log('  gbp-public: 2 consecutive blocks — breaker tripped, halting the lane'); break; }
      if (i < specs.length - 1) {
        const wait = pauseMs ?? (live ? humanDelayMs(30000, 75000) : 0);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
    }
  } finally {
    if (browserHandle?.context) await browserHandle.context.close().catch(() => {});
    else if (browserHandle?.browser) await browserHandle.browser.close().catch(() => {});
  }
  return { ranAt, entities, blockedCount, note: blockedCount ? 'blocked rows are EXCLUDED from comparisons — never counted as zeros' : null };
}

/**
 * PURE: turn a capture into the `signals` shape assessLocal() consumes — only the
 * fields the public surface actually observed; everything else stays absent so the
 * factor model reports honest 'unknown' findings.
 */
export function toLocalSignals(capture = {}) {
  const client = (capture.entities || []).find((e) => e.role === 'client');
  if (!client || client.status !== 'ok' || !client.panel) return {};
  const p = client.panel;
  const signals = {};
  if (p.categoryShown) signals.gbp = { primaryCategory: p.categoryShown };
  if (p.address) signals.addressVisible = true;
  if (p.rating !== null || p.reviewCount !== null) {
    signals.reviews = { count: p.reviewCount ?? undefined };
  }
  return signals;
}
