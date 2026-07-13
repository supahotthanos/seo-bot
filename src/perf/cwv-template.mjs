// seo-bot · perf/cwv-template — template-level CWV ENFORCEMENT (the gap: image-seo audits
// images, but LCP-preload / INP 3p-JS-deferral / CLS slot-reservation weren't applied at
// the template). This turns cwvDiagnose's Lighthouse output into CONCRETE template patches:
// preload + fetchpriority on the detected LCP element, defer/async render-blocking JS,
// next/image (AVIF/WebP+srcset+dimensions), width/height for CLS — emitted for the Next.js
// apply adapter. One lean template makes every programmatic page pass. Pure mapper tested.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso } from '../util.mjs';

/** Map a cwvDiagnose result → concrete template patches. Pure. */
export function cwvTemplatePatches(diagnose = {}) {
  const patches = [];
  const lcp = String(diagnose.lcpElement || '');
  const img = lcp.match(/(?:src|srcset|href)=["']([^"'\s]+)/i);
  if (/<img|image|background-image|picture/i.test(lcp)) {
    if (img) patches.push({ type: 'head', code: `<link rel="preload" as="image" href="${img[1]}" fetchpriority="high">`, why: 'preload the LCP image so it renders first (LCP)' });
    patches.push({ type: 'attr', target: 'LCP <img>', code: 'fetchpriority="high" + loading="eager" (never lazy on the LCP image)', why: 'prioritize the LCP element (LCP)' });
  }
  for (const o of diagnose.opportunities || []) {
    const id = o.id || '';
    if (id === 'render-blocking-resources' || id === 'render-blocking-insight') patches.push({ type: 'script', code: 'defer/async render-blocking <script>; inline critical CSS', why: o.title || id });
    else if (/modern-image-formats|uses-responsive-images|efficiently-encode-images|uses-optimized-images/.test(id)) patches.push({ type: 'img', code: 'next/image (AVIF/WebP + srcset + explicit width/height)', why: o.title || id });
    else if (id === 'layout-shift-elements' || id === 'non-composited-animations') patches.push({ type: 'attr', code: 'set explicit width/height on media + reserve space for embeds/ads (CLS)', why: o.title || id });
    else if (/unused-javascript|bootup-time|mainthread-work-breakdown/.test(id)) patches.push({ type: 'script', code: 'code-split + defer non-critical/3p JS (improves INP)', why: o.title || id });
    else if (id === 'offscreen-images') patches.push({ type: 'attr', code: 'loading="lazy" on below-the-fold images only', why: o.title || id });
    else if (id === 'server-response-time') patches.push({ type: 'infra', code: 'edge cache / CDN to cut TTFB', why: o.title || id });
    else if (id === 'uses-text-compression') patches.push({ type: 'infra', code: 'enable gzip/brotli at the server/CDN', why: o.title || id });
    else if (id === 'font-display') patches.push({ type: 'head', code: 'font-display:swap on web fonts', why: o.title || id });
  }
  // de-dupe identical patches
  const seen = new Set();
  return patches.filter((p) => { const k = p.type + p.code; if (seen.has(k)) return false; seen.add(k); return true; });
}

export async function cwvTemplatePlan(cfg, url = cfg.baseUrl, { strategy = 'mobile', log = () => {} } = {}) {
  const { cwvDiagnose } = await import('../data/pagespeed.mjs');
  const d = await cwvDiagnose(cfg, url, { strategy, log: () => {} });
  if (!d.enabled) return { enabled: false, note: d.note };
  const patches = cwvTemplatePatches(d);
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const L = [`# CWV template fix-plan — ${cfg.brand}`, `${url} · ${strategy} · perf ${d.perfScore}/100 · ${nowIso()}`, '',
    '> Apply ONCE at the template — every programmatic page then passes. Fix to "Good", then stop.', ''];
  patches.forEach((p, i) => L.push(`${i + 1}. [${p.type}] ${p.code}\n   ↳ ${p.why}`));
  if (!patches.length) L.push('- no CWV template fixes needed ✅');
  writeFileSync(join(dir, `cwv-template-${strategy}.md`), L.join('\n'));
  log(`\n  CWV template plan ${strategy}: perf ${d.perfScore} · ${patches.length} template patches → ${join(dir, `cwv-template-${strategy}.md`)}\n`);
  return { enabled: true, url, strategy, perfScore: d.perfScore, patches };
}
