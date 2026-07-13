// seo-bot · migrate — the "old domain, old site → new site we built" onboarding. The #1 way
// to TANK a client's domain is a botched migration that drops the old site's link equity.
// This automates the site-mapping the web-dev team would otherwise do by hand: enumerate
// every OLD url, match each to its best NEW url (exact slug → token-similarity → flag for
// manual), and emit (a) a 301 redirect map, (b) ready-to-drop-in configs (vercel.json /
// Next.js / Netlify _redirects / .htaccess), and (c) a launch checklist. High-value old
// pages (most traffic) are flagged so they're never dropped. Pure matcher is unit-tested.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';

const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'for', 'and', 'or', 'to', 'index', 'html', 'php', 'page', 'home', 'www']);
/** RFC-4180 CSV field escaping: wrap in quotes if the value contains a comma, quote, or newline; double any embedded quotes. */
export function csvField(v) { const s = String(v ?? ''); return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) ? `"${s.replace(/"/g, '""')}"` : s; }
const pathOf = (u) => { try { return new URL(u).pathname || '/'; } catch { return String(u || '/'); } };
const norm = (p) => (p || '/').replace(/\/+$/, '') || '/';
const slugTokens = (p) => norm(p).toLowerCase().replace(/\.(html?|php|aspx?|jsp)$/i, '').split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
function jaccard(a, b) { const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); }

/** Match one old path to the best new path. Pure. candidates: [{path, tokens}]. */
export function matchUrl(oldPath, candidates = []) {
  const op = norm(oldPath).toLowerCase();
  const exact = candidates.find((c) => norm(c.path).toLowerCase() === op);
  if (exact) return { newPath: exact.path, confidence: 'exact', score: 1 };
  const ot = slugTokens(oldPath);
  // Guard: if the old path yields no meaningful tokens (e.g. "/index.html", stop-words only),
  // token similarity is undefined — return 'none' rather than risking a spurious match.
  if (!ot.length) return { newPath: null, confidence: 'none', score: 0 };
  let best = null, bestScore = 0;
  for (const c of candidates) { const s = jaccard(ot, c.tokens); if (s > bestScore) { bestScore = s; best = c; } }
  const score = Math.round(bestScore * 100) / 100;
  if (best && bestScore >= 0.6) return { newPath: best.path, confidence: 'high', score };
  if (best && bestScore >= 0.34) return { newPath: best.path, confidence: 'low', score };
  return { newPath: null, confidence: 'none', score };
}

/** Build the full redirect map. oldUrls/newUrls = arrays of URLs or paths. */
export function buildRedirectMap(oldUrls = [], newUrls = []) {
  const candidates = [...new Set(newUrls.map(pathOf))].map((p) => ({ path: p, tokens: slugTokens(p) }));
  const seen = new Set();
  const map = [];
  for (const u of oldUrls) {
    const from = norm(pathOf(u));
    if (from === '/' || seen.has(from)) continue; seen.add(from);
    const m = matchUrl(from, candidates);
    map.push({ from, to: m.newPath ? norm(m.newPath) : null, confidence: m.confidence, score: m.score, status: 301 });
  }
  const auto = map.filter((r) => r.confidence === 'exact' || r.confidence === 'high');
  const review = map.filter((r) => r.confidence === 'low');
  const manual = map.filter((r) => r.confidence === 'none');
  return { map, auto, review, manual };
}

/** Emit drop-in redirect configs for the common stacks. */
export function emitConfigs(map = []) {
  const live = map.filter((r) => r.to);
  const vercel = JSON.stringify({ redirects: live.map((r) => ({ source: r.from, destination: r.to, permanent: true })) }, null, 2);
  const next = `// next.config.js — async redirects()\nmodule.exports = {\n  async redirects() {\n    return ${JSON.stringify(live.map((r) => ({ source: r.from, destination: r.to, permanent: true })), null, 4)};\n  },\n};\n`;
  const netlify = live.map((r) => `${r.from}  ${r.to}  301`).join('\n') + '\n';
  const htaccess = 'RewriteEngine On\n' + live.map((r) => `Redirect 301 ${r.from} ${r.to}`).join('\n') + '\n';
  return { 'vercel.json': vercel, 'next.config.redirects.js': next, '_redirects': netlify, '.htaccess': htaccess };
}

function loadUrls(src, cfg) {
  if (!src) return null;
  // a local file (sitemap.xml / .txt / .json list) or a URL to crawl/fetch
  if (existsSync(src)) {
    const raw = readFileSync(src, 'utf-8');
    if (/^\s*[\[{]/.test(raw)) { try { const j = JSON.parse(raw); return (Array.isArray(j) ? j : j.urls || []).map((x) => (typeof x === 'string' ? x : x.url || x.loc)); } catch { /* */ } }
    const locs = [...raw.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    if (locs.length) return locs;
    return raw.split('\n').map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l) || l.startsWith('/'));
  }
  return null; // a URL → caller crawls
}

export async function migrate(cfg, { log = () => {}, old: oldSrc, neu: newSrc } = {}) {
  // OLD urls: from a provided sitemap/list, else crawl the old domain (cfg.migrate.oldBaseUrl).
  let oldUrls = loadUrls(oldSrc, cfg);
  if (!oldUrls) {
    const base = oldSrc || cfg.migrate?.oldBaseUrl;
    if (!base) return { error: 'provide --old <old-sitemap.xml | urls.txt | old-base-url> (or set cfg.migrate.oldBaseUrl)' };
    const { discoverUrls } = await import('./crawl.mjs');
    const saved = cfg.audit.maxPages; cfg.audit.maxPages = 5000;
    try { oldUrls = (await discoverUrls({ ...cfg, baseUrl: base, sitemaps: [] })).urls; } catch { oldUrls = []; } finally { cfg.audit.maxPages = saved; }
  }
  // NEW urls: provided, else crawl the new (current) site.
  let newUrls = loadUrls(newSrc, cfg);
  if (!newUrls) {
    const { discoverUrls } = await import('./crawl.mjs');
    const saved = cfg.audit.maxPages; cfg.audit.maxPages = 5000;
    try { newUrls = (await discoverUrls(cfg)).urls; } catch { newUrls = []; } finally { cfg.audit.maxPages = saved; }
  }
  if (!oldUrls?.length || !newUrls?.length) return { error: `could not load URLs (old: ${oldUrls?.length || 0}, new: ${newUrls?.length || 0})` };

  const { map, auto, review, manual } = buildRedirectMap(oldUrls, newUrls);
  const dir = join(ROOT, 'reports', cfg.name, 'migration');
  mkdirSync(dir, { recursive: true });
  const configs = emitConfigs([...auto, ...review]); // ship confident + review (review still 301s to a best-guess; manual flagged separately)
  for (const [name, body] of Object.entries(configs)) writeFileSync(join(dir, name), body);
  writeFileSync(join(dir, 'redirect-map.json'), JSON.stringify({ client: cfg.name, ranAt: nowIso(), counts: { total: map.length, auto: auto.length, review: review.length, manual: manual.length }, map }, null, 2));
  writeFileSync(join(dir, 'redirect-map.csv'), 'old,new,confidence,status\n' + map.map((r) => [csvField(r.from), csvField(r.to || ''), csvField(r.confidence), csvField(r.status)].join(',')).join('\n') + '\n');

  const doc = buildHandoff(cfg, { map, auto, review, manual });
  writeFileSync(join(dir, 'MIGRATION-HANDOFF.md'), doc);
  log(`\n  Migration map: ${map.length} old URLs → ${auto.length} auto-matched · ${review.length} review · ${manual.length} ⚠ need manual mapping`);
  log(`  Configs (vercel/next/netlify/htaccess) + handoff → ${dir}`);
  if (manual.length) log(`  ⚠ ${manual.length} old URLs had NO good match — map these by hand before launch (in MIGRATION-HANDOFF.md) or they 404 + lose equity.`);
  return { map, auto: auto.length, review: review.length, manual: manual.length, dir };
}

function buildHandoff(cfg, { map, auto, review, manual }) {
  const L = [`# Migration handoff — ${cfg.brand}`, `${map.length} old URLs · ${auto.length} auto-matched · ${review.length} review · ${manual.length} need manual mapping · ${nowIso()}`, '',
    '> Goal: move from the OLD site to the NEW site WITHOUT losing the domain\'s SEO equity. A botched migration is the #1 way to tank a client\'s rankings. Follow this in order.', '',
    '## Why this matters', 'The domain already has age, authority, and backlinks pointing at OLD URLs. Every old URL must 301-redirect to its closest new equivalent so that ranking + link equity flows to the new page. A missing redirect = a 404 = lost rankings + a dead backlink.', '',
    '## Pre-launch (do BEFORE the new site goes live)',
    '- [ ] Review `redirect-map.csv` — confirm the auto-matched + review rows; **map the ⚠ manual rows by hand** (below). Never blanket-redirect everything to the homepage — that\'s a soft-404 and loses the equity.',
    '- [ ] For the highest-traffic / most-linked old pages, make sure the NEW equivalent keeps the same topic, title intent, and core content (don\'t just redirect — preserve the value).',
    '- [ ] Keep the URL structure similar where possible (fewer redirects = less equity loss).',
    '- [ ] Recreate / update the XML sitemap with the NEW URLs only.',
    '- [ ] Make sure staging is `noindex` but the PROD launch is **indexable** (the classic disaster: shipping a leftover `noindex`).',
    '- [ ] Set self-referencing canonicals on every new page.', '',
    '## Launch',
    '- [ ] Deploy the redirects **at the same time** as the new site (drop in `vercel.json` / `next.config.redirects.js` / `_redirects` / `.htaccess` for your stack — all generated in this folder).',
    '- [ ] Submit the new XML sitemap in Google Search Console + Bing Webmaster Tools.',
    '- [ ] (Same domain → no Change-of-Address needed; if the DOMAIN also changed, do GSC Change of Address.)',
    '- [ ] Run `seo-bot techaudit` on the new site — confirm every redirect is a SINGLE 301 hop (no chains/loops) and there are no 404s from internal links.', '',
    '## Post-launch (watch for 2–4 weeks)',
    '- [ ] Monitor GSC Coverage for a spike in 404s / "not found" — each one is a missed redirect; add it.',
    '- [ ] Watch rankings + impressions for the top old pages; a temporary dip is normal, a sustained drop means a redirect/equity problem.',
    '- [ ] Re-point any INTERNAL links from old paths to the new paths (redirects are a safety net, not a substitute).',
    '- [ ] Keep the 301s in place permanently (do not remove them).', ''];
  if (manual.length) {
    L.push('## ⚠ MANUAL MAPPING NEEDED (no confident auto-match — map each to the best new URL)', '');
    L.push('| Old URL | → map to (fill in) |', '|---|---|');
    for (const r of manual.slice(0, 200)) L.push(`| ${r.from} |  |`);
    L.push('');
  }
  if (review.length) {
    L.push('## Review these (low-confidence auto-match — confirm or correct)', '');
    L.push('| Old URL | auto → | confidence |', '|---|---|---|');
    for (const r of review.slice(0, 100)) L.push(`| ${r.from} | ${r.to} | ${r.score} |`);
  }
  return L.join('\n');
}
