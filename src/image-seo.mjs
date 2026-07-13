// seo-bot · image-seo — image audit + sitemap. Med-spa sites are image-heavy (galleries,
// before/afters) and routinely ship alt-less, IMG_1234-named photos that are invisible to
// Google Images, Lens, and AI vision. This audits every <img> for the high-frequency
// failures and generates a 2026-valid image sitemap (only <image:image>+<image:loc> — the
// caption/title/license fields were removed). Before/after photos are flagged for HUMAN
// review, never auto-described (FTC substantiation + HIPAA patient-consent risk).

import * as cheerio from 'cheerio';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { absUrl, nowIso } from './util.mjs';

const GENERIC_RE = /\/(img|image|dsc|dcim|photo|untitled|screenshot|unnamed)[-_ ]?\d+|\/(IMG|DSC)_\d+/i;
const NEXTGEN = /\.(webp|avif)(\?|$)/i;
const RASTER = /\.(jpg|jpeg|png|gif)(\?|$)/i;
const BEFORE_AFTER = /before|after|b-a|results?|transformation/i;

export async function auditImages(cfg, { log = () => {} } = {}) {
  const { discoverUrls, fetchPages } = await import('./crawl.mjs');
  const { urls } = await discoverUrls(cfg);
  const pages = await fetchPages(urls, cfg);

  const byUrl = new Map(); // image src -> { pages:Set, alt, ... }
  const findings = [];
  for (const p of pages) {
    if (!p.ok) continue;
    const $ = cheerio.load(p.html || '');
    $('img').each((_, el) => {
      const srcRaw = $(el).attr('src') || $(el).attr('data-src') || '';
      const src = absUrl(p.finalUrl || p.url, srcRaw);
      if (!src || src.startsWith('data:')) return;
      const alt = $(el).attr('alt');
      const rec = byUrl.get(src) || { src, alt, onPages: new Set(), beforeAfter: BEFORE_AFTER.test(src + ' ' + (alt || '')) };
      rec.onPages.add(p.finalUrl || p.url);
      if (alt != null && rec.alt == null) rec.alt = alt;
      byUrl.set(src, rec);
    });
  }

  const imgs = [...byUrl.values()];
  const missingAlt = imgs.filter((i) => i.alt == null);
  const emptyAlt = imgs.filter((i) => i.alt != null && i.alt.trim() === '' && !i.beforeAfter);
  const genericName = imgs.filter((i) => GENERIC_RE.test(i.src));
  const rasterOnly = imgs.filter((i) => RASTER.test(i.src) && !NEXTGEN.test(i.src));
  const beforeAfter = imgs.filter((i) => i.beforeAfter);
  // Auto-fixable alt: non-before/after images missing alt → safe to draft alt text.
  const autoFixable = missingAlt.filter((i) => !i.beforeAfter);

  const L = [`# Image SEO — ${cfg.brand}`, `${imgs.length} unique images across ${pages.filter((p) => p.ok).length} pages · ${nowIso()}`, ''];
  const sec = (t, arr, fmt) => { L.push(`## ${t} (${arr.length})`); if (!arr.length) L.push('- none ✅'); else arr.slice(0, 30).forEach((x) => L.push('- ' + fmt(x))); L.push(''); };
  sec('🔴 Missing alt (auto-fixable — not before/after)', autoFixable, (i) => `${i.src}  (on ${i.onPages.size} page${i.onPages.size > 1 ? 's' : ''})`);
  sec('⚠️ Before/after — needs HUMAN alt + consent check (do NOT auto-describe)', beforeAfter, (i) => `${i.src}${i.alt == null ? ' [no alt]' : ''}`);
  sec('🟠 Empty alt on content image', emptyAlt, (i) => i.src);
  sec('🟡 Generic filename (rename for image SEO / Lens)', genericName, (i) => i.src);
  sec('🟡 Raster only — serve WebP/AVIF for CWV', rasterOnly, (i) => i.src);

  // 2026 image sitemap: group images by the page they appear on.
  const pagesMap = new Map();
  for (const i of imgs) for (const pg of i.onPages) { if (!pagesMap.has(pg)) pagesMap.set(pg, []); pagesMap.get(pg).push(i.src); }
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">'];
  for (const [pg, srcs] of pagesMap) { xml.push(`  <url>\n    <loc>${pg}</loc>`); for (const s of [...new Set(srcs)]) xml.push(`    <image:image><image:loc>${s.replace(/&/g, '&amp;')}</image:loc></image:image>`); xml.push('  </url>'); }
  xml.push('</urlset>');

  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'image-seo.md'), L.join('\n'));
  writeFileSync(join(dir, 'sitemap-images.xml'), xml.join('\n'));
  writeFileSync(join(dir, 'image-seo.json'), JSON.stringify({ client: cfg.name, ranAt: nowIso(), images: imgs.length, missingAlt: missingAlt.length, autoFixable: autoFixable.length, beforeAfter: beforeAfter.length, genericName: genericName.length, rasterOnly: rasterOnly.length }, null, 2));

  log(`\n  Images: ${imgs.length} unique · ${autoFixable.length} auto-fixable alt · ${beforeAfter.length} before/after (human) · ${genericName.length} generic-named · ${rasterOnly.length} non-nextgen`);
  log(`  Image sitemap → ${join(dir, 'sitemap-images.xml')}`);
  log(`  → ${join(dir, 'image-seo.md')}\n`);
  return { images: imgs.length, missingAlt, autoFixable, beforeAfter, genericName, rasterOnly };
}
