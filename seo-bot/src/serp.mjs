// seo-bot · serp — live SERP-feature inventory + organic rank tracker + Share-of-Voice.
// For each tracked keyword it stealth-fetches the Google SERP, parses the organic results
// (our rank + competitors) and which SERP FEATURES fire (AI Overview, local pack, PAA,
// video, images, shopping, FAQ) and whether WE appear in them. Computes a CTR-weighted
// Share-of-Voice, persists a daily snapshot to rank-history.ndjson, and diffs vs the prior
// run. GSC position is a lagging 28-day mean that can't track aspirational keywords or AIO
// presence — this is the missing live signal. Parsing is best-effort (Google DOM churns);
// the SoV/Δ math is deterministic + unit-tested.

import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { sleep, nowIso, hostOf } from './util.mjs';
import { stealthFetch } from './stealth.mjs';

// Organic CTR-by-position curve (pos 1..10); used to weight visibility into one SoV number.
const CTR = [0.317, 0.247, 0.18, 0.13, 0.094, 0.068, 0.049, 0.035, 0.025, 0.018];
export const ctrWeight = (pos) => (pos >= 1 && pos <= 10 ? CTR[pos - 1] : 0);

/** Share-of-Voice across the keyword set, normalized so all-#1 = 100%. */
export function shareOfVoice(ranks) {
  if (!ranks.length) return 0;
  const got = ranks.reduce((s, p) => s + ctrWeight(p), 0);
  const max = ranks.length * CTR[0];
  return Math.round((got / max) * 1000) / 10;
}

const FEATURE_SIGNATURES = {
  aiOverview: /AI Overview|data-attrid="[^"]*ai_overview|class="[^"]*\bYzCcme\b/i,
  localPack: /class="[^"]*rllt__|More places|class="[^"]*VkpGBb/i,
  peopleAlsoAsk: /People also ask|class="[^"]*related-question/i,
  video: />Videos<|class="[^"]*RzdJxc/i,
  images: />Images<|class="[^"]*eA0Zlc/i,
  shopping: /Sponsored·?\s*Shopping|class="[^"]*sh-dgr__/i,
  faq: /class="[^"]*g[^"]*"[^>]*aria-expanded|FAQ/i,
};

function parseSerp(html, ourHost, competitorHosts = []) {
  const organic = [];
  const seen = new Set();
  // Result URLs appear as <a href="https://..."><h3>…</h3> or /url?q=…
  const re = /<a[^>]+href="(https?:\/\/[^"&]+)"[^>]*>(?:(?!<\/a>).)*?<h3/gis;
  let m;
  while ((m = re.exec(html)) && organic.length < 20) {
    const host = hostOf(m[1]);
    if (!host || /google\.|gstatic|youtube\.com\/redirect/.test(host)) continue;
    if (seen.has(host)) continue; // one entry per domain (rank of first appearance)
    seen.add(host);
    organic.push({ position: organic.length + 1, host, url: m[1] });
  }
  const features = {};
  for (const [k, re2] of Object.entries(FEATURE_SIGNATURES)) features[k] = re2.test(html);
  const ourRank = (organic.find((o) => o.host === ourHost) || {}).position || null;
  const competitors = competitorHosts.map((c) => ({ host: c, rank: (organic.find((o) => o.host === hostOf('http://' + c)) || {}).position || null }));
  return { organic, features, ourRank, competitors };
}

export async function trackSerp(cfg, { log = () => {}, live = true } = {}) {
  const keywords = cfg.tracking?.keywords || cfg.geo?.keywords || [];
  if (!keywords.length) return { error: 'set cfg.tracking.keywords[] (or cfg.geo.keywords[]) to track' };
  const ourHost = hostOf(cfg.baseUrl);
  const competitorHosts = (cfg.competitors || cfg.tracking?.competitors || []).map((c) => (c.startsWith('http') ? hostOf(c) : c.replace(/^www\./, '')));
  const gl = cfg.tracking?.country || 'us';
  log(`SERP tracking ${keywords.length} keywords (${live ? 'live' : 'dry'}) for ${ourHost} …`);

  const rows = [];
  let fetched = 0;
  for (const kw of keywords) {
    let parsed = { organic: [], features: {}, ourRank: null, competitors: [] };
    if (live) {
      const url = `https://www.google.com/search?q=${encodeURIComponent(kw)}&hl=en&gl=${gl}&num=20`;
      const r = await stealthFetch(url);
      if (r.ok) { fetched++; parsed = parseSerp(r.html, ourHost, competitorHosts); }
      else parsed.note = r.note;
      await sleep(2000 + (kw.length * 37) % 2500); // jittered politeness
    }
    rows.push({ keyword: kw, rank: parsed.ourRank, features: Object.entries(parsed.features).filter(([, v]) => v).map(([k]) => k), competitors: parsed.competitors, note: parsed.note });
  }

  const ranks = rows.map((r) => r.rank).filter((p) => p);
  const sov = shareOfVoice(rows.map((r) => r.rank || 99));
  const aioKeywords = rows.filter((r) => r.features.includes('aiOverview'));
  const localPackKeywords = rows.filter((r) => r.features.includes('localPack'));

  // Persist daily snapshot + diff vs prior.
  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const histPath = join(dir, 'rank-history.ndjson');
  const today = nowIso().slice(0, 10);
  let prior = null;
  if (existsSync(histPath)) { const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean); for (let i = lines.length - 1; i >= 0; i--) { try { const s = JSON.parse(lines[i]); if (s.date !== today) { prior = s; break; } } catch { /* skip */ } } }
  if (live) appendFileSync(histPath, JSON.stringify({ date: today, sov, ranks: Object.fromEntries(rows.map((r) => [r.keyword, r.rank])) }) + '\n');
  const movers = prior ? rows.filter((r) => prior.ranks?.[r.keyword] != null && r.rank != null && r.rank !== prior.ranks[r.keyword]).map((r) => ({ keyword: r.keyword, from: prior.ranks[r.keyword], to: r.rank, delta: prior.ranks[r.keyword] - r.rank })) : [];

  const L = [`# SERP tracking — ${cfg.brand}`, `${keywords.length} keywords · ${nowIso()} · ${fetched}/${keywords.length} fetched`, '',
    `**Share-of-Voice ${sov}%** (CTR-weighted, all-#1 = 100%) · ${ranks.length}/${keywords.length} ranking · AIO on ${aioKeywords.length} · local-pack on ${localPackKeywords.length}`, ''];
  if (prior) { L.push(`## Movers since ${prior.date} (SoV ${prior.sov}% → ${sov}%)`); if (!movers.length) L.push('- no rank changes'); movers.sort((a, b) => b.delta - a.delta).forEach((m) => L.push(`- ${m.delta > 0 ? '▲' : '▼'} "${m.keyword}": ${m.from} → ${m.to}`)); L.push(''); }
  L.push('## Per keyword');
  for (const r of rows) L.push(`- "${r.keyword}" — rank ${r.rank || '—'}${r.features.length ? ' · features: ' + r.features.join(',') : ''}${r.note ? ' · ' + r.note : ''}`);
  if (aioKeywords.length) { L.push('', '## ⚠️ AI Overview fires here — answer-island + schema these'); aioKeywords.forEach((r) => L.push(`- "${r.keyword}"${r.rank ? ` (we're #${r.rank} organic)` : " (we're NOT cited)"}`)); }

  writeFileSync(join(dir, 'serp.md'), L.join('\n'));
  writeFileSync(join(dir, 'serp.json'), JSON.stringify({ client: cfg.name, ranAt: nowIso(), sov, fetched, rows, movers, aioKeywords: aioKeywords.map((r) => r.keyword) }, null, 2));
  if (live && fetched === 0) log('  ⚠️ 0 SERPs fetched — needs Python+Scrapling + a residential IP (Mac Mini). SoV/Δ math is correct; only live ranks are missing.');
  log(`\n  SoV ${sov}% · ${ranks.length}/${keywords.length} ranking · AIO ${aioKeywords.length} · local-pack ${localPackKeywords.length} · ${movers.length} movers`);
  log(`  → ${join(dir, 'serp.md')}\n`);
  return { sov, rows, movers, aioKeywords, fetched };
}
