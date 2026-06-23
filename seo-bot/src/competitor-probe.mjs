// seo-bot · competitor-probe — the OTTO-defect sales weapon (Epic 16, work-unit A12).
//
// Given a prospect URL, detect whether Search Atlas / OTTO is injecting SEO via a
// client-side pixel (or a Cloudflare-Worker reverse proxy) and report EXACTLY what
// that hides from AI crawlers. The thesis (per the 100x plan §1.3): OTTO's default
// pixel mutates the DOM after load, so GPTBot/ClaudeBot/PerplexityBot — which don't
// run JS — never see the "fixed" title/meta/H1/schema. We prove it from raw HTML.
//
// Headless (real JS render) is Mac-only per the scraping rule, so on Windows we run
// the RAW-HTML half (what AI crawlers see) and flag the pixel; the diff-vs-rendered
// half is noted as "run on Mac for the rendered comparison". Reuses inspect/audit
// primitives (parsePage from rules.mjs) and writes a ready-to-send report to
// sales-playbook/. Read-only network fetch; the only write is the sales report file.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { fetchPage, nowIso, slugify, hostOf } from './util.mjs';
import { parsePage } from './rules.mjs';

// Script hosts / markers that betray a Search Atlas / OTTO pixel deployment.
const OTTO_MARKERS = [
  { re: /dashboard\.searchatlas\.com/i, label: 'Search Atlas dashboard script host' },
  { re: /sa-dynamic-optimization/i, label: 'OTTO "sa-dynamic-optimization" pixel' },
  { re: /searchatlas\.com\/.*\.js/i, label: 'Search Atlas JS payload' },
  { re: /linkgraph/i, label: 'LinkGraph (Search Atlas parent) marker' },
  { re: /otto[-_]?pixel/i, label: 'OTTO pixel reference' },
  { re: /data-sa-/i, label: 'Search Atlas data-* attribute hook' },
];

// Other common third-party SEO overlays worth flagging for the same AI-invisibility risk.
const OTHER_OVERLAYS = [
  { re: /cdn\.surferseo\.com|surfer/i, label: 'Surfer SEO' },
  { re: /rankmath/i, label: 'RankMath (WP)' },
  { re: /schemaapp\.com/i, label: 'SchemaApp client-side injector' },
];

/** Detect overlay signatures + Cloudflare-Worker fingerprints from html + headers. */
export function detectOverlays(html, headers) {
  const found = [];
  for (const m of [...OTTO_MARKERS, ...OTHER_OVERLAYS]) if (m.re.test(html || '')) found.push(m.label);
  // Cloudflare Worker reverse-proxy hint (OTTO's "Mode B" edge HTMLRewriter path).
  const server = headers?.get?.('server') || '';
  const cfWorker = /cloudflare/i.test(server) && (headers.get('cf-ray') || headers.get('cf-worker'));
  const isOtto = found.some((f) => /search\s?atlas|otto|linkgraph/i.test(f));
  return { found: [...new Set(found)], isOtto, cloudflareEdge: !!cfWorker, server };
}

/**
 * Heuristic for "this SEO element is likely JS-injected (AI-invisible)":
 * the raw HTML is missing or weak on an element AND a pixel is present — the classic
 * OTTO-1943 signature (Googlebot sees the JS fix, AI crawlers see the raw gap).
 */
function rawGaps(parsed) {
  const gaps = [];
  if (!parsed.title || parsed.titleLen < 15) gaps.push({ el: 'title', raw: parsed.title || '(missing)' });
  if (!parsed.metaDesc) gaps.push({ el: 'meta description', raw: '(missing)' });
  if (!parsed.canonical) gaps.push({ el: 'canonical', raw: '(missing)' });
  if (!parsed.h1s?.length) gaps.push({ el: 'H1', raw: '(missing)' });
  if (!parsed.jsonLdCount) gaps.push({ el: 'JSON-LD schema', raw: '(none)' });
  else if (!parsed.jsonLdValid) gaps.push({ el: 'JSON-LD schema', raw: '(present but invalid)' });
  return gaps;
}

/**
 * Probe one prospect URL.
 * @returns { url, host, overlay, rawParsed, gaps, verdict, note }
 */
export async function probeUrl(url, { log = () => {} } = {}) {
  log(`  fetching raw HTML (what AI crawlers see) — ${url}`);
  const res = await fetchPage(url, { timeoutMs: 20000 });
  if (!res.ok || !res.text) return { url, error: res.error || `status ${res.status}`, status: res.status };
  const overlay = detectOverlays(res.text, res.headers);
  const parsed = parsePage(res.text, url, {});
  const gaps = rawGaps(parsed);

  // Verdict: an overlay present + raw SEO gaps == elements likely live only post-JS.
  let verdict, note;
  if (overlay.isOtto && gaps.length) {
    verdict = 'OTTO-class AI-invisibility risk';
    note = `Search Atlas/OTTO pixel detected AND ${gaps.length} core SEO element(s) absent from raw HTML. If those elements appear only after JS, GPTBot/ClaudeBot/PerplexityBot never see them (OTTO-1943).`;
  } else if (overlay.isOtto) {
    verdict = 'OTTO pixel present (verify rendered diff on Mac)';
    note = 'Pixel detected but raw HTML still carries the core elements — confirm on a headless render whether the pixel adds anything AI crawlers miss, and check load-time regression (pixel adds ~+44% FCP).';
  } else if (overlay.found.length && gaps.length) {
    verdict = 'Third-party SEO overlay + raw gaps';
    note = `Overlay(s): ${overlay.found.join(', ')}. ${gaps.length} raw SEO gap(s) — same AI-invisibility risk class as OTTO if injected client-side.`;
  } else if (gaps.length) {
    verdict = 'Raw SEO gaps (no overlay detected)';
    note = `${gaps.length} core element(s) missing from server-rendered HTML — opportunity regardless of tooling.`;
  } else {
    verdict = 'Clean raw HTML';
    note = 'Core SEO elements are server-rendered. No obvious AI-invisibility defect from the raw pass.';
  }
  return { url, host: hostOf(url), overlay, rawParsed: { title: parsed.title, metaLen: parsed.metaLen, h1s: parsed.h1s, jsonLdTypes: [...new Set(parsed.jsonLdTypes)], jsonLdCount: parsed.jsonLdCount }, gaps, verdict, note };
}

/** Render the "what OTTO is hiding from ChatGPT on your site" sales report. */
export function renderReport(prospect, probe) {
  const L = [];
  L.push(`# What OTTO is hiding from ChatGPT on ${probe.host}`);
  L.push(`<sub>Probe ${new Date().toUTCString()} · ${prospect}</sub>`);
  L.push('');
  L.push(`**Verdict: ${probe.verdict}.**`);
  L.push('');
  L.push(probe.note);
  L.push('');
  if (probe.overlay.found.length) {
    L.push(`## Detected on the page`);
    for (const f of probe.overlay.found) L.push(`- ${f}`);
    if (probe.overlay.cloudflareEdge) L.push(`- Cloudflare edge in the request path (server: ${probe.overlay.server}) — possible OTTO "Mode B" Worker rewrite (independent testing has caught this path drifting into bot-vs-human cloaking).`);
    L.push('');
  }
  if (probe.gaps.length) {
    L.push(`## Missing from the RAW HTML (what AI crawlers actually fetch)`);
    L.push(`AI crawlers (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot) do **not** run JavaScript. Anything injected by a client-side pixel is invisible to them. These elements are absent from the server-rendered HTML:`);
    L.push('');
    for (const g of probe.gaps) L.push(`- **${g.el}** — raw value: ${g.raw}`);
    L.push('');
  } else {
    L.push(`## Raw HTML coverage`);
    L.push(`Core elements (title, meta, canonical, H1, schema) ARE present server-side on this page.`);
    L.push('');
  }
  L.push(`## What we'd do differently`);
  L.push(`- Write every fix into **server-rendered source** (visible to every crawler on first byte, permanent, version-controlled) — not a rented JS pixel that vanishes when the subscription lapses.`);
  L.push(`- Prove it with a **render-parity check**: raw no-JS HTML must already contain the title/meta/H1/schema, asserted in CI so a pixel-only "fix" is impossible.`);
  L.push(`- No third-party reverse proxy in your request path, so no cloaking-drift risk and no ~+44% FCP load penalty.`);
  L.push('');
  L.push(`> Headless (real JS-rendered) comparison is run from our Mac environment per our scraping policy. This report is the raw-HTML half — the exact bytes ChatGPT's crawler receives.`);
  L.push('');
  L.push('---');
  L.push('_Generated by seo-bot competitor-probe. Diagnostic, not legal advice._');
  return L.join('\n');
}

/** CLI entry: probe a prospect URL and write the sales report into sales-playbook/. */
export async function competitorProbe(url, { log = () => {} } = {}) {
  if (!url) { log('  usage: probe <prospectUrl>'); return { ok: false }; }
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const probe = await probeUrl(target, { log });
  if (probe.error) { log(`  ✗ probe failed: ${probe.error}`); return { ok: false, error: probe.error }; }
  log(`\n  ${probe.verdict}`);
  log(`  ${probe.note}`);
  const dir = join(ROOT, 'sales-playbook', 'probes');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `otto-probe-${slugify(probe.host)}.md`);
  writeFileSync(file, renderReport(target, probe));
  log(`\n  Sales report → ${file}\n`);
  return { ok: true, probe, file };
}
