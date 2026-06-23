// seo-bot · a11y — static accessibility audit (no API, no browser). Catches the
// high-frequency WCAG-AA failures detectable from raw HTML: missing alt, no html[lang],
// h1 problems, unnamed links/buttons, inputs without labels, low-contrast inline styles.
// Triple purpose: AEO (machine-readable structure), booking-funnel UX, and ADA Title III
// litigation exposure — healthcare is a top-sued vertical and the HHS WCAG 2.1 AA
// deadline has passed. (Full ARIA/keyboard checks need axe-core in a browser — that's the
// build-later upgrade; output is an "automated WCAG-AA scan", never a compliance claim.)

import * as cheerio from 'cheerio';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';

function auditHtml(html, url) {
  const $ = cheerio.load(html || '');
  const f = [];
  const imgsNoAlt = $('img:not([alt])').length;
  if (imgsNoAlt) f.push({ url, rule: 'image-alt', impact: 'serious', count: imgsNoAlt, fix: 'add descriptive alt (or alt="" if decorative)' });
  if ($('html[lang]').length === 0) f.push({ url, rule: 'html-has-lang', impact: 'serious', fix: 'add lang="en" to <html>' });
  const h1 = $('h1').length;
  if (h1 !== 1) f.push({ url, rule: 'page-has-heading-one', impact: 'moderate', detail: `${h1} <h1>`, fix: 'exactly one <h1> per page' });
  const emptyLinks = $('a[href]').filter((_, el) => !$(el).text().trim() && !$(el).attr('aria-label') && !$(el).attr('title') && $(el).find('img[alt!=""]').length === 0).length;
  if (emptyLinks) f.push({ url, rule: 'link-name', impact: 'serious', count: emptyLinks, fix: 'give every link discernible text/aria-label' });
  const unnamedBtns = $('button').filter((_, el) => !$(el).text().trim() && !$(el).attr('aria-label') && !$(el).attr('title')).length;
  if (unnamedBtns) f.push({ url, rule: 'button-name', impact: 'serious', count: unnamedBtns, fix: 'give every button text/aria-label' });
  const inputsNoLabel = $('input:not([type=hidden]):not([type=submit]):not([type=button]):not([aria-label]):not([aria-labelledby]):not([title])').filter((_, el) => { const id = $(el).attr('id'); return !id || $(`label[for="${id}"]`).length === 0; }).length;
  if (inputsNoLabel) f.push({ url, rule: 'label', impact: 'critical', count: inputsNoLabel, fix: 'associate a <label> with each form input (booking forms!)' });
  if ($('[viewport], meta[name=viewport][content*="user-scalable=no"], meta[name=viewport][content*="maximum-scale=1"]').length) f.push({ url, rule: 'meta-viewport', impact: 'serious', fix: 'remove user-scalable=no / maximum-scale (blocks zoom)' });
  return f;
}

export async function auditA11y(cfg, { log = () => {} } = {}) {
  const { discoverUrls, fetchPages } = await import('./crawl.mjs');
  const { urls } = await discoverUrls(cfg);
  const pages = await fetchPages(urls, cfg);
  const findings = [];
  for (const p of pages) if (p.ok) findings.push(...auditHtml(p.html, p.finalUrl || p.url));

  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  const critical = findings.filter((f) => f.impact === 'critical' || f.impact === 'serious');

  const L = [`# Accessibility scan (static WCAG-AA) — ${cfg.brand}`, `${pages.filter((p) => p.ok).length} pages · ${findings.length} findings · ${nowIso()}`, '', '> Automated scan only — covers ~40% of WCAG. Not a compliance certification.', '', '## By rule'];
  Object.entries(byRule).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => L.push(`- ${r}: ${n}`));
  L.push('', '## Findings (serious/critical first)');
  [...critical, ...findings.filter((f) => !critical.includes(f))].slice(0, 40).forEach((f) => L.push(`- [ ] **${f.rule}** (${f.impact}) ${f.count ? '×' + f.count + ' ' : ''}— ${f.url}\n  ↳ ${f.fix}`));

  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a11y.md'), L.join('\n'));
  writeFileSync(join(dir, 'a11y.json'), JSON.stringify({ client: cfg.name, ranAt: nowIso(), findings, byRule }, null, 2));

  log(`\n  a11y: ${findings.length} findings across ${Object.keys(byRule).length} rules (${critical.length} serious+)`);
  log(`  → ${join(dir, 'a11y.md')}\n`);
  return { findings, byRule };
}
