// seo-bot · cro — booking-funnel leak audit. An agency paid per booking lives or dies on
// whether the consult/booking page converts. This does a raw-HTML conversion audit of the
// money pages (tel: link, booking CTA, form friction, trust signals, above-fold CTA) and
// JOINS the GA4 per-page conversion rate + Microsoft Clarity frustration signals (rage/
// dead clicks, JS errors) when connected — so it can say "this booking page leaks, here's
// why". The signals GA4/GSC alone can't surface.

import * as cheerio from 'cheerio';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';

const MONEY_RE = /book|consult|contact|appointment|schedule|treatment|service|pricing|cost/i;

function auditConversion(html, url) {
  const $ = cheerio.load(html || '');
  const text = $('body').text();
  const hasTel = $('a[href^="tel:"]').length > 0;
  const bookingCta = $('a,button').filter((_, el) => /book|schedule|appointment|consult|reserve|get started/i.test($(el).text())).length;
  const bookingLink = $('a[href*="book"],a[href*="vagaro"],a[href*="boulevard"],a[href*="mindbody"],a[href*="schedule"],a[href*="calendly"],a[href*="acuity"]').length;
  const forms = $('form').length;
  const formFields = $('form input:not([type=hidden]):not([type=submit]),form select,form textarea').length;
  const hasReviews = /\b(\d\.\d|\d)\s*(★|stars?|\/\s*5)\b/i.test(text) || $('[class*="review" i],[class*="rating" i]').length > 0;
  const issues = [];
  if (!hasTel) issues.push('no tap-to-call (tel:) link — mobile bookings leak');
  if (!bookingCta && !bookingLink) issues.push('no obvious booking/consult CTA');
  if (forms && formFields > 6) issues.push(`booking form has ${formFields} fields — each field over ~4 cuts completion`);
  if (!hasReviews) issues.push('no visible reviews/rating trust signal near the CTA');
  return { url, hasTel, bookingCta, bookingLink, forms, formFields, hasReviews, issues };
}

export async function auditCRO(cfg, { log = () => {} } = {}) {
  const { discoverUrls, fetchPages } = await import('./crawl.mjs');
  const { urls } = await discoverUrls(cfg);
  const pages = await fetchPages(urls.filter((u) => MONEY_RE.test(u) || u === cfg.baseUrl), cfg);
  const audited = pages.filter((p) => p.ok).map((p) => auditConversion(p.html, p.finalUrl || p.url));

  // Join GA4 conversion rate (high traffic + low conversion = priority).
  let ga4 = { enabled: false };
  try { const { ga4Report } = await import('./data/ga4.mjs'); ga4 = await ga4Report(cfg, { log: () => {} }); } catch { /* optional */ }
  const crByPath = new Map();
  if (ga4.enabled) for (const r of ga4.rows || []) crByPath.set((r.page || '').replace(/\/$/, ''), r.sessions ? r.conversions / r.sessions : null);

  // Join Clarity frustration signals if a token is set.
  let clarity = { enabled: false };
  try { const { clarityInsights } = await import('./data/clarity.mjs'); clarity = await clarityInsights(cfg, { log: () => {} }); } catch { /* optional */ }

  for (const a of audited) {
    const path = new URL(a.url).pathname.replace(/\/$/, '');
    a.conversionRate = crByPath.has(path) ? crByPath.get(path) : null;
    if (a.conversionRate != null && a.conversionRate < 0.01) a.issues.push(`GA4 conversion rate ${(a.conversionRate * 100).toFixed(2)}% — below 1% floor on a money page`);
  }
  const leaks = audited.filter((a) => a.issues.length).sort((a, b) => b.issues.length - a.issues.length);

  const L = [`# Booking-funnel CRO audit — ${cfg.brand}`, `${audited.length} money pages · GA4 ${ga4.enabled ? 'joined' : 'off'} · Clarity ${clarity.enabled ? 'joined' : 'off'} · ${nowIso()}`, ''];
  L.push('## Leaks (most issues first)');
  if (!leaks.length) L.push('- none — money pages have tel:, CTA, lean forms, trust signals ✅');
  for (const a of leaks) { L.push(`\n### ${a.url}`); a.issues.forEach((i) => L.push(`- [ ] ${i}`)); }
  if (clarity.enabled && clarity.frustration?.length) { L.push('', '## Clarity frustration signals (last 1-3d)'); clarity.frustration.forEach((f) => L.push(`- ${f.metric}`)); }

  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cro.md'), L.join('\n'));
  writeFileSync(join(dir, 'cro.json'), JSON.stringify({ client: cfg.name, ranAt: nowIso(), ga4: ga4.enabled, clarity: clarity.enabled, audited, leaks }, null, 2));

  log(`\n  CRO: ${audited.length} money pages · ${leaks.length} leaking${ga4.enabled ? ' (GA4 conv joined)' : ''}${clarity.enabled ? ' (Clarity joined)' : ''}`);
  if (leaks.length) log(`  Worst: ${leaks[0].url} (${leaks[0].issues.length} issues)`);
  log(`  → ${join(dir, 'cro.md')}\n`);
  return { audited, leaks, ga4: ga4.enabled, clarity: clarity.enabled };
}
