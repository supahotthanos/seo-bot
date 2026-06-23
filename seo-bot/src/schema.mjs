// seo-bot · schema — offline structured-data lint (no API). Parses JSON-LD from the
// HTML the crawler already fetched, reports coverage + parse errors, and classifies
// types by 2026 rich-result eligibility. CRITICAL: FAQPage/HowTo no longer earn rich
// results (deprecated May 2026) — the bot must stop treating them as wins. Med-spa pages
// live/die on (Medical)LocalBusiness + Review/AggregateRating + per-service Offer.

import * as cheerio from 'cheerio';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';

const RICH_ELIGIBLE = new Set(['LocalBusiness', 'MedicalBusiness', 'MedicalClinic', 'HealthAndBeautyBusiness', 'Dentist', 'Physician', 'Organization', 'Product', 'Offer', 'AggregateOffer', 'Review', 'AggregateRating', 'BreadcrumbList', 'Article', 'NewsArticle', 'BlogPosting', 'VideoObject', 'Event', 'Service', 'Person', 'WebSite', 'ImageObject', 'Recipe', 'JobPosting']);
const DEPRECATED_RICH = new Set(['FAQPage', 'HowTo', 'QAPage']); // valid markup, but no longer render rich (May 2026)
const MEDSPA_CORE = /Business|MedicalClinic|MedicalBusiness|Organization/;

function collect(node, out) {
  if (!node) return;
  if (Array.isArray(node)) return node.forEach((n) => collect(n, out));
  if (typeof node === 'object') {
    if (node['@type']) [].concat(node['@type']).forEach((t) => out.push(t));
    if (node['@graph']) collect(node['@graph'], out);
  }
}

function typesFromHtml(html) {
  const $ = cheerio.load(html || '');
  const types = [];
  let parseError = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    try { collect(JSON.parse($(el).contents().text()), types); } catch { parseError = true; }
  });
  return { types: [...new Set(types)], parseError };
}

export async function lintSchema(cfg, { log = () => {} } = {}) {
  const { discoverUrls, fetchPages } = await import('./crawl.mjs');
  const { urls } = await discoverUrls(cfg);
  const pages = await fetchPages(urls, cfg);
  const perPage = [], parseErrors = [], deprecatedHits = [], missingCore = [];
  for (const p of pages) {
    if (!p.ok) continue;
    const url = p.finalUrl || p.url;
    const { types, parseError } = typesFromHtml(p.html);
    perPage.push({ url, types });
    if (parseError) parseErrors.push(url);
    const dep = types.filter((t) => DEPRECATED_RICH.has(t));
    if (dep.length) deprecatedHits.push({ url, types: dep });
    if (!types.some((t) => MEDSPA_CORE.test(t))) missingCore.push(url);
  }
  const allTypes = {};
  for (const pg of perPage) for (const t of pg.types) allTypes[t] = (allTypes[t] || 0) + 1;

  const L = [`# Structured-data lint — ${cfg.brand}`, `${perPage.length} pages · ${nowIso()}`, ''];
  L.push('## Type coverage');
  Object.entries(allTypes).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
    const tag = DEPRECATED_RICH.has(t) ? '⚠️ no-longer-rich (2026)' : RICH_ELIGIBLE.has(t) ? '✅ rich-eligible' : 'ℹ️';
    L.push(`- ${t} ×${n}  ${tag}`);
  });
  if (parseErrors.length) { L.push('', `## ❌ JSON-LD parse errors (${parseErrors.length}) — these emit NOTHING`); parseErrors.slice(0, 20).forEach((u) => L.push(`- ${u}`)); }
  if (deprecatedHits.length) { L.push('', `## ⚠️ Deprecated rich types — stop counting as wins (${deprecatedHits.length})`); deprecatedHits.slice(0, 20).forEach((d) => L.push(`- ${d.url} — ${d.types.join(', ')}`)); }
  if (missingCore.length) { L.push('', `## Missing (Medical)LocalBusiness/Organization (${missingCore.length})`); missingCore.slice(0, 20).forEach((u) => L.push(`- [ ] ${u} → add MedicalBusiness/LocalBusiness JSON-LD`)); }

  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'schema.md'), L.join('\n'));
  writeFileSync(join(dir, 'schema.json'), JSON.stringify({ client: cfg.name, ranAt: nowIso(), pages: perPage.length, typeCoverage: allTypes, parseErrors, deprecatedHits, missingCore }, null, 2));

  log(`\n  Schema: ${perPage.length} pages · ${Object.keys(allTypes).length} types · ${parseErrors.length} parse errors · ${deprecatedHits.length} deprecated · ${missingCore.length} missing core`);
  log(`  → ${join(dir, 'schema.md')}\n`);
  return { perPage, allTypes, parseErrors, deprecatedHits, missingCore };
}
