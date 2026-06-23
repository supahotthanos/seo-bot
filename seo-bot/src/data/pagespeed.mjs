// seo-bot · data/pagespeed — PageSpeed Insights API (FREE). Lab (Lighthouse) + field
// (CrUX) Core Web Vitals in one call. Works keyless at low volume; PAGESPEED_API_KEY (a
// plain GCP key, NOT the OAuth client) lifts the quota to 25k/day. Image-heavy med-spa
// WP/Wix sites routinely fail mobile — an easy, quantified audit win. Good thresholds
// (web.dev): LCP ≤2.5s, INP ≤200ms, CLS ≤0.1.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso } from '../util.mjs';

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const ms = (v) => (v == null ? null : Math.round(v));
const rate = (good, ni, v) => (v == null ? '?' : v <= good ? 'good' : v <= ni ? 'needs-improvement' : 'poor');

// Lighthouse audit id → the concrete on-site fix (this is the actual SEO WORK, not a flag).
const FIX = {
  'render-blocking-resources': 'Inline critical CSS + defer/async the blocking JS (often a theme/plugin).',
  'unused-javascript': 'Code-split + tree-shake; drop unused JS (page-builders ship a lot).',
  'unused-css-rules': 'Purge unused CSS (Tailwind purge / strip unused theme CSS).',
  'modern-image-formats': 'Serve WebP/AVIF (next/image or an image CDN).',
  'uses-responsive-images': 'Serve correctly-sized images via srcset / next/image.',
  'efficiently-encode-images': 'Compress images (lossy WebP / mozjpeg).',
  'offscreen-images': 'Lazy-load below-the-fold images (loading="lazy").',
  'prioritize-lcp-image': 'Preload the LCP image + fetchpriority="high"; never lazy-load it.',
  'lcp-lazy-loaded': 'Remove lazy-loading from the LCP image.',
  'server-response-time': 'Cut TTFB: cache/CDN, faster host, move to the edge.',
  'uses-text-compression': 'Enable gzip/brotli at the server or CDN.',
  'unminified-javascript': 'Minify JS in the build step.',
  'unminified-css': 'Minify CSS in the build step.',
  'total-byte-weight': 'Reduce total page weight (images + JS are usually the bulk).',
  'mainthread-work-breakdown': 'Reduce main-thread JS work (hurts INP/responsiveness).',
  'bootup-time': 'Reduce JS execution time; defer non-critical third-party scripts.',
  'layout-shift-elements': 'Set explicit width/height on images + reserve space for embeds/ads (CLS).',
  'non-composited-animations': 'Animate transform/opacity only (composited) to avoid jank.',
  'uses-rel-preconnect': 'Preconnect to critical third-party origins (fonts, booking widget).',
  'font-display': 'Use font-display:swap so text is never invisible.',
  'render-blocking-insight': 'Eliminate render-blocking requests in the critical path.',
};

function lcpElement(a) {
  const it = a['largest-contentful-paint-element']?.details?.items;
  if (!it?.length) return null;
  return it[0]?.items?.[0]?.node?.snippet || it[0]?.node?.snippet || it[0]?.items?.[0]?.node?.selector || null;
}

/** Parse the Lighthouse audits into a prioritized, actionable CWV fix list (the SEO work). */
export async function cwvDiagnose(cfg, url = cfg.baseUrl, { strategy = 'mobile', log = () => {} } = {}) {
  const key = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_API_KEY;
  const qs = new URLSearchParams({ url, strategy, category: 'performance' });
  if (key) qs.set('key', key);
  try {
    const r = await fetch(`${ENDPOINT}?${qs.toString()}`);
    const j = await r.json();
    if (!r.ok) return { enabled: false, note: j.error?.message || `status ${r.status}` };
    const lh = j.lighthouseResult || {}, a = lh.audits || {};
    const opportunities = Object.entries(a)
      .filter(([id, au]) => au && au.score != null && au.score < 0.9 && (au.details?.overallSavingsMs > 0 || (FIX[id] && au.score < 0.9)))
      .map(([id, au]) => ({ id, title: au.title, savingsMs: Math.round(au.details?.overallSavingsMs || 0), savingsKb: au.details?.overallSavingsBytes ? Math.round(au.details.overallSavingsBytes / 1024) : 0, fix: FIX[id] || au.title }))
      .sort((x, y) => y.savingsMs - x.savingsMs || y.savingsKb - x.savingsKb);
    const perfScore = Math.round((lh.categories?.performance?.score || 0) * 100);
    const lcpEl = lcpElement(a);

    const L = [`# Core Web Vitals diagnosis — ${cfg.brand}`, `${url} · ${strategy} · perf ${perfScore}/100 · ${nowIso()}`, ''];
    if (lcpEl) L.push(`**LCP element:** \`${String(lcpEl).slice(0, 160)}\` — make this render first (preload, no lazy-load, prioritize).`, '');
    L.push('## Prioritized fixes (by estimated savings)');
    if (!opportunities.length) L.push('- none — performance is clean ✅');
    opportunities.slice(0, 20).forEach((o) => L.push(`- [ ] **${o.title}**${o.savingsMs ? ` (~${o.savingsMs}ms${o.savingsKb ? `, ${o.savingsKb}KB` : ''})` : ''}\n  ↳ ${o.fix}`));

    const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `cwv-${strategy}.md`), L.join('\n'));
    writeFileSync(join(dir, `cwv-${strategy}.json`), JSON.stringify({ client: cfg.name, ranAt: nowIso(), url, strategy, perfScore, lcpElement: lcpEl, opportunities }, null, 2));
    log(`\n  CWV diagnosis ${strategy}: perf ${perfScore} · ${opportunities.length} fixes · top: ${opportunities[0]?.title || 'none'}`);
    log(`  → ${join(dir, `cwv-${strategy}.md`)}`);
    return { enabled: true, url, strategy, perfScore, lcpElement: lcpEl, opportunities };
  } catch (e) { return { enabled: false, note: String(e.message || e) }; }
}

export async function pageSpeed(cfg, url = cfg.baseUrl, { strategy = 'mobile', log = () => {} } = {}) {
  const key = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_API_KEY;
  const qs = new URLSearchParams({ url, strategy, category: 'performance' });
  if (key) qs.set('key', key);
  try {
    const r = await fetch(`${ENDPOINT}?${qs.toString()}`);
    const j = await r.json();
    if (!r.ok) return { enabled: false, note: j.error?.message || `status ${r.status}` };
    const lh = j.lighthouseResult || {}, a = lh.audits || {};
    const field = j.loadingExperience?.metrics || {};
    const labLcp = ms(a['largest-contentful-paint']?.numericValue);
    const labCls = a['cumulative-layout-shift']?.numericValue ?? null;
    const labTbt = ms(a['total-blocking-time']?.numericValue);
    const fLcp = field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null;
    const fInp = field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null;
    const fCls = field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null;
    const out = {
      enabled: true, url, strategy, perfScore: Math.round((lh.categories?.performance?.score || 0) * 100),
      lab: { lcpMs: labLcp, tbtMs: labTbt, cls: labCls },
      field: { lcpMs: fLcp, inpMs: fInp, cls: fCls, lcp: rate(2500, 4000, fLcp), inp: rate(200, 500, fInp), cls_rating: rate(0.1, 0.25, fCls) },
      hasFieldData: !!j.loadingExperience?.metrics,
    };
    log(`  PSI ${strategy} ${url}: perf ${out.perfScore} · field LCP ${out.field.lcp} / INP ${out.field.inp} / CLS ${out.field.cls_rating}`);
    return out;
  } catch (e) { return { enabled: false, note: String(e.message || e) }; }
}
