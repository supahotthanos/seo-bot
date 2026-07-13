// seo-bot · sources — "what are the AI engines pulling from most?" A citation-source
// gap engine. NO API CALLS: it reads the citations captured by the stealth consumer-app
// tracker (scripts/ai-visibility/track.mjs via `measure`), aggregates which DOMAINS the
// engines cite most across the prompt panel, flags where the client is ABSENT, and emits
// a ranked off-site target worklist for the off-site SEO team (get listed / reviewed /
// mentioned on the sources the models already trust).

import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso, hostOf } from '../util.mjs';

// Source-type map (which platforms are claimable off-site assets vs not).
const TYPES = [
  ['own', []], // filled from cfg
  ['review-directory', [/yelp\./, /realself/, /healthgrades/, /zocdoc/, /vitals\./, /ratemds/, /threebestrated/, /trustpilot/, /g2\.com/, /angi\./, /thumbtack/, /yellowpages/, /expertise\.com/, /birdeye/, /nicelocal/, /mapquest/, /booksy/, /vagaro/, /spafinder/]],
  ['ugc-community', [/reddit\./, /quora\./, /youtube\./, /youtu\.be/, /tiktok\./, /facebook\./, /instagram\./, /nextdoor\./, /x\.com/, /twitter\./, /linkedin\./]],
  ['encyclopedic', [/wikipedia\.org/, /wikidata/, /\.fandom\./]],
  ['gov-edu-medical', [/\.gov\b/, /\.edu\b/, /nih\.gov/, /fda\.gov/, /plasticsurgery\.org/, /aad\.org/, /asds\.net/, /americanmedspa/]],
  ['maps', [/google\.[a-z.]+\/maps/, /maps\.google/, /apple\.com\/maps/]],
  ['news-editorial', [/nytimes|forbes|cnn|allure|byrdie|cosmopolitan|self\.com|today\.com|wellandgood|harpersbazaar|vogue|newbeauty/]],
];

const CLAIMABLE = new Set(['review-directory', 'ugc-community', 'encyclopedic']);

export function classify(host, cfg) {
  const h = host.replace(/^www\./, '');
  if (cfg.domain && h.includes(cfg.domain.replace(/^www\./, ''))) return 'own';
  // Known platforms (yelp/reddit/etc.) win over a competitor-name collision — a directory
  // is a target even if a competitor is *named* "Yelp". Then competitor match, length-guarded
  // (>=5) so a short token like "a" can't poison every host. (Verifier-found bug.)
  for (const [type, res] of TYPES) if (res.some((re) => re.test(host))) return type;
  const comps = (cfg.competitors || []).map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, '')).filter((c) => c.length >= 5);
  if (comps.some((c) => h.replace(/[^a-z0-9]/g, '').includes(c))) return 'competitor';
  return 'other';
}

/** Read the most recent AI-visibility capture for a client (from `measure`). */
function readLatestVisibility(client) {
  const dirs = [join(ROOT, 'reports', client, 'ai-visibility'), join(ROOT, 'data', 'ai-visibility')];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    const files = readdirSync(d).filter((f) => f.endsWith('.json')).sort();
    if (files.length) { try { return JSON.parse(readFileSync(join(d, files[files.length - 1]), 'utf-8')); } catch { /* */ } }
  }
  return null;
}

/** Aggregate which sources the engines pull from most + the off-site gap worklist. */
export function analyzeSources(cfg, { log = () => {} } = {}) {
  const data = readLatestVisibility(cfg.name);
  if (!data?.results?.length) {
    log(`  No AI-visibility capture found. Run \`node seo-bot/bin/seo-bot.mjs measure ${cfg.name}\` first (no API — it drives the real ChatGPT/Perplexity/Google-AIO apps and records citations).`);
    return null;
  }
  const valid = data.results.filter((r) => !r.error && (r.citedDomains?.length || r.cited !== undefined));
  const byDomain = new Map(); // host -> { count, engines:Set, prompts:Set, type }
  let answersWithCitations = 0;
  for (const r of valid) {
    const cites = (r.citedDomains || []).map((d) => hostOf(d.startsWith('http') ? d : `https://${d}`) || d.replace(/^www\./, ''));
    if (cites.length) answersWithCitations++;
    for (const host of new Set(cites)) {
      if (!host) continue;
      const e = byDomain.get(host) || { host, count: 0, engines: new Set(), prompts: new Set(), type: classify(host, cfg) };
      e.count++; e.engines.add(r.engine); e.prompts.add(r.prompt);
      byDomain.set(host, e);
    }
  }
  const ranked = [...byDomain.values()]
    .map((e) => ({ host: e.host, type: e.type, citations: e.count, engines: [...e.engines], promptCount: e.prompts.size }))
    .sort((a, b) => b.citations - a.citations);

  const ownPresent = ranked.some((r) => r.type === 'own');
  // Off-site worklist: high-citation, CLAIMABLE sources where the client is absent.
  const worklist = ranked
    .filter((r) => CLAIMABLE.has(r.type))
    .map((r) => ({ ...r, action: r.type === 'review-directory' ? 'Claim + optimize the profile; drive real reviews' : r.type === 'ugc-community' ? 'Earn genuine mentions/threads (Reddit/YouTube)' : 'Get an entity/page (Wikipedia/Wikidata) if notable' }))
    .slice(0, 25);

  const result = {
    client: cfg.name, ranAt: nowIso(), capturedAt: data.ranAt, engines: data.summary ? Object.keys(data.summary) : [],
    answersAnalyzed: valid.length, answersWithCitations, ownPresent,
    topSources: ranked.slice(0, 40), offsiteWorklist: worklist,
  };

  // ---- write ----
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sources.json'), JSON.stringify(result, null, 2));
  const L = [`# AI citation-source map — ${cfg.brand}`, `From ${valid.length} AI answers captured ${data.ranAt ? new Date(data.ranAt).toUTCString() : ''} · NO API (consumer-app scrape)`, ''];
  L.push(`> What the engines pull from most, for the client's prompt panel. The off-site team targets the sources where we're ABSENT.`, '');
  L.push('## What the AI engines cite most');
  L.push('| Rank | Source | Type | Citations | Engines |');
  L.push('|---|---|---|---|---|');
  ranked.slice(0, 30).forEach((r, i) => L.push(`| ${i + 1} | ${r.host} | ${r.type} | ${r.citations} | ${r.engines.join(', ')} |`));
  L.push('', `## Off-site target worklist (claimable sources we're absent from)`, '');
  for (const w of worklist) L.push(`- [ ] **${w.host}** (${w.type}, cited ${w.citations}×) — ${w.action}`);
  if (!ownPresent) L.push('', `⚠ The client domain was **not cited at all** in the captured answers — the off-site presence above is the path in.`);
  writeFileSync(join(dir, 'sources.md'), L.join('\n'));

  log(`\n  Sources — ${cfg.brand}: ${valid.length} answers, ${ranked.length} distinct sources, client ${ownPresent ? 'IS' : 'is NOT'} cited`);
  log(`  Top cited:`);
  ranked.slice(0, 8).forEach((r, i) => log(`    ${i + 1}. ${r.host.padEnd(28)} ${String(r.citations).padStart(3)}×  [${r.type}]`));
  log(`  Off-site targets (claimable, we're absent): ${worklist.length} → ${join(dir, 'sources.md')}\n`);
  return result;
}
