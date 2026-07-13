// seo-bot · measure/fanout-atlas — the "mindset per city + prompt" the operator asked for.
//
// For each (city × money-prompt × reasoning-tier), drive the LOGGED-IN ChatGPT session and capture
// the Edward-Sturm fan-out: the sub-queries ChatGPT actually fires AND the sites it pulls from.
// Accrues across runs into a persistent atlas (ndjson) → a living doc of "what fan-out fires + which
// sites dominate" per city and overall. This is the map you optimize content + citations against.
//
// SAFETY: every capture rides src/measure/capture-governor — a small per-run cap, human-paced
// delays, and a graceful stop when ChatGPT's per-account MESSAGE limit is hit (resume next run).
// It NEVER tries to defeat a challenge. Fail-closed: blocked/empty captures are excluded.

import { captureFanout } from './fanout-capture.mjs';
import { makeGovernor, humanDelayMs, isChallenge, isRateLimit, inCooldown, SAFE_DEFAULTS } from './capture-governor.mjs';

const hostOf = (u = '') => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

// The market grid = the canonical list (src/measure/markets.mjs, ~65 metros). Re-exported under the
// historical name so serp-radar + the CLI keep importing TOP_US_MEDSPA_CITIES from here.
export { US_MEDSPA_MARKETS as TOP_US_MEDSPA_CITIES } from './markets.mjs';

// Money prompts (the intents worth ranking for). {city} is filled per market.
export const MEDSPA_PROMPT_TEMPLATES = [
  'best med spas in {city}',
  'top rated med spa near {city}',
  'where should I get Botox in {city}',
  'most reputable medical spa in {city} with real reviews',
  'affordable med spa in {city} for fillers',
];

// Reasoning tiers the operator wants compared. Mapped to model labels; selectTier is best-effort in
// the live UI and records the model actually used, so the atlas is honest about which tier it saw.
export const TIERS = ['low', 'medium', 'high'];

/** PURE: aggregate capture rows → the atlas (top sites, recurring sub-queries, per-city breakdown). */
export function aggregateAtlas(rows = []) {
  const ok = rows.filter((r) => r && r.status === 'ok');
  const domainCounts = new Map();   // domain -> { cites, cities:Set, tiers:Set }
  const subqueryCounts = new Map(); // normalized sub-query -> count
  const byCity = new Map();         // city -> { captures, domains:Map }
  const byTierDomain = new Map();   // tier -> Map(domain -> count)
  const bizByCity = new Map();      // city -> Map(business -> { ranks:[], count })
  const bizOverall = new Map();     // business -> { cities:Set, ranks:[] }
  for (const r of ok) {
    const city = r.city || '(unknown)';
    const tier = r.tier || r.model || 'default';
    for (const sq of (r.subqueries || [])) {
      const k = String(sq).toLowerCase().replace(/\s+/g, ' ').trim();
      if (k) subqueryCounts.set(k, (subqueryCounts.get(k) || 0) + 1);
    }
    // RANKED businesses — who ChatGPT ranks #1..N for this city (the tracking signal).
    for (const item of (r.ranked || [])) {
      const name = String(item.name || '').trim(); if (!name) continue;
      const cm = bizByCity.get(city) || new Map();
      const rec = cm.get(name) || { name, ranks: [], count: 0 }; rec.ranks.push(Number(item.rank) || 0); rec.count += 1; cm.set(name, rec); bizByCity.set(city, cm);
      const o = bizOverall.get(name) || { name, cities: new Set(), ranks: [] }; o.cities.add(city); o.ranks.push(Number(item.rank) || 0); bizOverall.set(name, o);
    }
    const c = byCity.get(city) || { city, captures: 0, domains: new Map() };
    c.captures += 1;
    for (const u of (r.citations?.urls || [])) {
      const d = hostOf(u); if (!d) continue;
      const dc = domainCounts.get(d) || { domain: d, cites: 0, cities: new Set(), tiers: new Set() };
      dc.cites += 1; dc.cities.add(city); dc.tiers.add(tier); domainCounts.set(d, dc);
      c.domains.set(d, (c.domains.get(d) || 0) + 1);
      const td = byTierDomain.get(tier) || new Map(); td.set(d, (td.get(d) || 0) + 1); byTierDomain.set(tier, td);
    }
    byCity.set(city, c);
  }
  const avg = (a) => (a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : 0);
  const rankingsByCity = [...bizByCity.entries()].map(([city, m]) => ({
    city, ranked: [...m.values()].map((b) => ({ name: b.name, avgRank: avg(b.ranks), appearances: b.count })).sort((a, b) => a.avgRank - b.avgRank),
  })).sort((a, b) => a.city.localeCompare(b.city));
  const topBusinesses = [...bizOverall.values()].map((b) => ({ name: b.name, cityCount: b.cities.size, avgRank: avg(b.ranks), appearances: b.ranks.length }))
    .sort((a, b) => b.appearances - a.appearances || a.avgRank - b.avgRank);
  const topDomains = [...domainCounts.values()]
    .map((r) => ({ domain: r.domain, cites: r.cites, cityCount: r.cities.size, tiers: [...r.tiers].sort() }))
    .sort((a, b) => b.cites - a.cites || b.cityCount - a.cityCount);
  const topSubqueries = [...subqueryCounts.entries()].map(([q, n]) => ({ q, n })).sort((a, b) => b.n - a.n);
  const cities = [...byCity.values()].map((c) => ({
    city: c.city, captures: c.captures,
    topDomains: [...c.domains.entries()].map(([domain, n]) => ({ domain, n })).sort((a, b) => b.n - a.n).slice(0, 10),
  })).sort((a, b) => a.city.localeCompare(b.city));
  const tiers = [...byTierDomain.entries()].map(([tier, m]) => ({
    tier, topDomains: [...m.entries()].map(([domain, n]) => ({ domain, n })).sort((a, b) => b.n - a.n).slice(0, 15),
  }));
  return { status: ok.length ? 'ok' : 'empty', captures: ok.length, topDomains, topSubqueries, cities, tiers, rankingsByCity, topBusinesses };
}

/** PURE: render the atlas as a Markdown doc. */
export function buildAtlasDoc(agg, { generatedAt = '', runs = 0 } = {}) {
  const L = [
    '# AI Fan-out Atlas — med-spa queries on ChatGPT',
    '',
    '> The "mindset per city + prompt": the sub-queries ChatGPT decomposes each money query into, and',
    '> the sites it pulls citations from most. Optimize your content to answer these sub-queries and earn',
    '> placement on these sources. Accrues across safe runs.',
    '',
    `**Captures analyzed:** ${agg.captures}  ·  **runs:** ${runs}  ·  **generated:** ${generatedAt}`,
    '',
    '## 🥇 Who ChatGPT ranks per city (the leaderboard we move over time)',
    '',
    ...((agg.rankingsByCity && agg.rankingsByCity.length)
      ? agg.rankingsByCity.flatMap((c) => [
          `### ${c.city}`,
          '',
          '| rank | business | avg rank | # times |',
          '|------|----------|----------|---------|',
          ...c.ranked.slice(0, 10).map((b, i) => `| ${i + 1} | ${b.name} | ${b.avgRank} | ${b.appearances} |`),
          '',
        ])
      : ['_no ranked answers captured yet_', '']),
    '## 📈 Businesses ChatGPT ranks most (across all cities)',
    '',
    ...((agg.topBusinesses && agg.topBusinesses.length)
      ? ['| business | # cities | avg rank | appearances |', '|----------|----------|----------|-------------|',
         ...agg.topBusinesses.slice(0, 40).map((b) => `| ${b.name} | ${b.cityCount} | ${b.avgRank} | ${b.appearances} |`), '']
      : ['_none captured yet_', '']),
    '## 🏆 Top sites ChatGPT pulls from (all cities × prompts)',
    '',
    '| # | domain | citations | # cities |',
    '|---|--------|-----------|----------|',
    ...agg.topDomains.slice(0, 40).map((d, i) => `| ${i + 1} | ${d.domain} | ${d.cites} | ${d.cityCount} |`),
    '',
    '## 🔎 Recurring fan-out sub-queries (what to answer on-page)',
    '',
    ...(agg.topSubqueries.length ? agg.topSubqueries.slice(0, 60).map((s) => `- [${s.n}×] ${s.q}`) : ['_none captured yet_']),
    '',
    '## 🧠 Sources by reasoning tier (low / medium / high)',
    '',
    ...(agg.tiers.length ? agg.tiers.flatMap((t) => [`### ${t.tier}`, ...t.topDomains.map((d) => `- ${d.domain} (${d.n}×)`), '']) : ['_tier data accrues as tiers are captured_', '']),
    '## 🗺️ Per-city breakdown',
    '',
    ...agg.cities.flatMap((c) => [`### ${c.city} — ${c.captures} captures`, ...(c.topDomains.length ? c.topDomains.map((d) => `- ${d.domain} (${d.n}×)`) : ['_no citations captured yet_']), '']),
  ];
  return L.join('\n');
}

/** PURE: expand the (cities × prompts × tiers) work-list in priority order. */
export function buildWorkList(cities = TOP_US_MEDSPA_CITIES, templates = MEDSPA_PROMPT_TEMPLATES, tiers = ['default']) {
  const work = [];
  for (const city of cities) for (const tpl of templates) for (const tier of tiers) {
    work.push({ city, tier, prompt: tpl.replace('{city}', city) });
  }
  return work;
}

/** Best-effort reasoning-tier selector in the live ChatGPT UI. Returns the model label seen, or null.
 *  Kept conservative: if the picker can't be driven, we capture at the default model and label it. */
export async function selectTier(page, tier) {
  try {
    const label = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="model-switcher-dropdown-button"], button[aria-label*="model" i]');
      return btn ? (btn.textContent || '').trim() : null;
    });
    return label || (tier !== 'default' ? `tier:${tier}` : null);
  } catch { return null; }
}

/** I/O orchestrator: governor-paced fan-out capture across the work-list; append ndjson + rebuild the doc.
 *  Resumable — a cursor file remembers where we stopped so the next run continues the coverage. */
export async function runFanoutAtlas(cfg = {}, { cities, templates, tiers = ['default'], fs = null, dir = null, log = () => {}, capture = captureFanout } = {}) {
  if (!fs || !dir) throw new Error('runFanoutAtlas needs { fs, dir } from the caller');
  const { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } = fs;
  mkdirSync(dir, { recursive: true });
  const ndjson = `${dir}/atlas.ndjson`;
  const cursorFile = `${dir}/.cursor`;
  const cooldownFile = `${dir}/.cooldown`;
  // COOLDOWN GATE (same contract as query-bank): after any halt, every caller — CLI, accrual
  // loop, eager operator — is refused until the window passes. chatgpt.com HTTP-throttles
  // navigation after bursts (live-diagnosed ERR_HTTP_RESPONSE_CODE_FAILURE); only time clears it.
  if (existsSync(cooldownFile)) {
    const cd = inCooldown(Number(readFileSync(cooldownFile, 'utf8').trim()) || 0, Date.now(), SAFE_DEFAULTS.cooldownMs);
    if (cd.cooling) {
      log(`  🧊 atlas in COOLDOWN after a prior halt — ${Math.ceil(cd.remainingMs / 60000)} min remaining. Not touching ChatGPT (account safety). Resumes automatically.`);
      return { captured: 0, halted: false, cooling: true, remainingMs: cd.remainingMs, accrued: 0, totalCells: 0, docPath: `${dir}/atlas.md` };
    }
  }
  const work = buildWorkList(cities || TOP_US_MEDSPA_CITIES, templates || MEDSPA_PROMPT_TEMPLATES, tiers);
  let cursor = existsSync(cursorFile) ? (Number(readFileSync(cursorFile, 'utf8').trim()) || 0) : 0;
  if (cursor >= work.length) cursor = 0; // wrap around → refresh coverage
  const gov = makeGovernor({ maxPerRun: SAFE_DEFAULTS.maxPerRun, maxPerDay: SAFE_DEFAULTS.maxPerDay });
  log(`  fan-out atlas: ${work.length} (city×prompt×tier) cells · resuming at #${cursor} · ≤${gov.hardCap()} this run (safe)`);
  let done = 0, halted = false, consecutiveErrors = 0, i = cursor;
  for (; i < work.length && !halted; i++) {
    if (!gov.allow()) { log(`  ⏹  run cap reached (${gov.count()}/${gov.hardCap()}) — coverage resumes next run at #${i}`); break; }
    const { city, prompt, tier } = work[i];
    gov.spend();
    // A hard navigation/capture throw (the HTTP-throttle presents as page.goto ERR_*) must NEVER
    // crash the run — it's a halt signal, handled like the message cap: stop, cooldown, resume later.
    let rec;
    try {
      rec = await capture(prompt, { engine: 'chatgpt', headful: true, settleMs: 22000, beforeSend: (p) => selectTier(p, tier) });
    } catch (e) {
      rec = { status: 'error', error: String(e.message || e).slice(0, 200), subqueries: [], citations: { urls: [] } };
    }
    const row = { ...rec, city, tier, i };
    // ChatGPT's per-account message cap → graceful stop (NOT a ban): halt, resume after reset.
    if (rec.status === 'blocked' || isChallenge(rec.answerExcerpt || '') || isRateLimit(rec.answerExcerpt || '')) {
      log(`  ⏸  ChatGPT limit/challenge reached at "${prompt}" — pausing atlas (resume next run). Nothing forced.`);
      halted = true;
    } else if (rec.status === 'ok') {
      appendFileSync(ndjson, JSON.stringify(row) + '\n'); done += 1; consecutiveErrors = 0;
      log(`  [${i + 1}/${work.length}] ${city} · ${tier}: ${rec.subqueries.length} sub-queries · ${(rec.citations?.urls || []).length} citations`);
    } else {
      consecutiveErrors += 1;
      log(`  [${i + 1}/${work.length}] ${city} · ${tier}: ${rec.status} (excluded)${rec.error ? ` — ${rec.error.slice(0, 100)}` : ''}`);
      if (consecutiveErrors >= 2) { log('  ⏸  consecutive hard errors (throttle signature) — halting politely.'); halted = true; }
    }
    writeFileSync(cursorFile, String(i + 1));
    if (!halted && i + 1 < work.length) await new Promise((r) => setTimeout(r, humanDelayMs(SAFE_DEFAULTS.minDelayMs, SAFE_DEFAULTS.maxDelayMs)));
  }
  if (halted) writeFileSync(cooldownFile, String(Date.now()));
  // Re-aggregate ALL accrued rows → the living doc.
  const allRows = existsSync(ndjson) ? readFileSync(ndjson, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const agg = aggregateAtlas(allRows);
  const doc = buildAtlasDoc(agg, { generatedAt: new Date().toISOString(), runs: '≥1' });
  writeFileSync(`${dir}/atlas.md`, doc);
  return { captured: done, halted, cursorAt: i, totalCells: work.length, accrued: allRows.length, docPath: `${dir}/atlas.md` };
}
