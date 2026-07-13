// seo-bot · geogrid — local map-pack rank tracking (LocalFalcon-style), the #1 thing a
// med-spa client pays for and the bot's biggest measurement blind spot. Generates an N×N
// lat/lng grid around the business, checks the target keyword's map-pack rank at each pin
// (via the existing stealth sidecar — logged-out, low-volume, randomized; honors the
// website-first + stealth-Maps posture, NOT the paid Places API), and computes ATRP
// (Average Total Rank Position), SoLV (Share of Local Voice = % of pins in the top 3),
// and an ASCII heatmap. Grid math + scoring are deterministic + unit-tested; the live
// fetch needs Python+Scrapling and (realistically) a residential IP.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { sleep, nowIso } from './util.mjs';
import { stealthFetch } from './stealth.mjs';

/** Build an N×N grid of lat/lng pins centered on (lat,lng) spanning ±radiusMiles. */
export function buildGrid(lat, lng, gridSize = 5, radiusMiles = 3) {
  const half = (gridSize - 1) / 2;
  const milesPerLat = 69.0;
  const milesPerLng = 69.0 * Math.cos((lat * Math.PI) / 180) || 69.0;
  const step = half ? radiusMiles / half : 0;
  const pts = [];
  for (let i = -half; i <= half; i++) for (let j = -half; j <= half; j++) {
    pts.push({ row: i + half, col: j + half, lat: +(lat + (i * step) / milesPerLat).toFixed(6), lng: +(lng + (j * step) / milesPerLng).toFixed(6) });
  }
  return pts;
}

/** ATRP + SoLV + visibility from an array of pin results ({rank|null}). */
export function scoreGrid(results) {
  const ranked = results.map((r) => (r.rank && r.rank <= 20 ? r.rank : 21)); // unranked = 21 (worst bucket)
  const atrp = ranked.reduce((s, x) => s + x, 0) / (ranked.length || 1);
  const inTop3 = results.filter((r) => r.rank && r.rank <= 3).length;
  const inTop10 = results.filter((r) => r.rank && r.rank <= 10).length;
  const found = results.filter((r) => r.rank).length;
  return { atrp: Math.round(atrp * 10) / 10, solv: Math.round((inTop3 / (results.length || 1)) * 100), top10Pct: Math.round((inTop10 / (results.length || 1)) * 100), coverage: Math.round((found / (results.length || 1)) * 100) };
}

/** Render an ASCII heatmap: rank 1-3 = ▓, 4-10 = ▒, 11-20 = ░, none = ·. */
export function heatmap(results, gridSize) {
  const cell = (r) => (!r || !r.rank ? ' · ' : r.rank <= 3 ? `[${r.rank}]` : r.rank <= 10 ? ` ${r.rank} ` : ` ${r.rank}`);
  const byRC = new Map(results.map((r) => [`${r.row},${r.col}`, r]));
  const lines = [];
  for (let row = 0; row < gridSize; row++) {
    let s = '  ';
    for (let col = 0; col < gridSize; col++) s += (cell(byRC.get(`${row},${col}`)) + '').padStart(5);
    lines.push(s);
  }
  return lines.join('\n');
}

// ===== E1: local-map-pack =====
/** Measurement tag for local/map-pack proposals: judge them on ATRP/SoLV from THIS
 *  grid, not organic position/CTR — proximity makes organic the wrong denominator
 *  (research/local-ranking-factors-2026.md §3). src/local/factors.mjs stamps every
 *  local proposal with { measure: { metric: MAP_PACK_METRIC } }. */
export const MAP_PACK_METRIC = 'map-pack';

/** True when a proposal should be judged on the geo-grid (ATRP/SoLV) instead of organic. */
export function isMapPackProposal(p) {
  return !!(p && typeof p === 'object' && p.measure && p.measure.metric === MAP_PACK_METRIC);
}

/** True when a CHANGE-CLASS is judged on the map-pack metric. src/local/factors.mjs stamps
 *  every local proposal type as 'local-<factorId>' with measure:{metric:MAP_PACK_METRIC},
 *  so the 'local-' prefix is the class-level fingerprint. Until a real geo-grid judgment
 *  path exists, these classes must not accrue keep/revert authority from organic data:
 *  buildPriors skips them and canAutoPromote refuses them (fail-closed). */
export function isMapPackClass(changeClass) {
  return typeof changeClass === 'string' && /^local-/i.test(changeClass.trim());
}
// ===== end E1 =====

function parseMapNames(html) {
  // Best-effort: Google Maps renders place names in aria-label on result links and in
  // .qBF1Pd / .fontHeadlineSmall nodes. Fragile by nature (DOM churns) — directional only.
  const names = [];
  const re1 = /aria-label="([^"]{3,80})"[^>]*class="[^"]*hfpxzc/gi;
  const re2 = /class="[^"]*qBF1Pd[^"]*"[^>]*>([^<]{3,80})</gi;
  let m;
  while ((m = re1.exec(html))) names.push(m[1].trim());
  if (!names.length) while ((m = re2.exec(html))) names.push(m[1].trim());
  return [...new Set(names)];
}

export async function geoGrid(cfg, { log = () => {}, keyword, gridSize = 5, radiusMiles = 3, live = true } = {}) {
  const geo = cfg.geo || {};
  if (geo.lat == null || geo.lng == null) return { error: 'set cfg.geo = { lat, lng, businessName?, keywords?[] } in the client config' };
  const kw = keyword || geo.keywords?.[0] || 'med spa';
  const business = (geo.businessName || cfg.brand || '').toLowerCase();
  const pins = buildGrid(geo.lat, geo.lng, gridSize, radiusMiles);
  log(`Geo-grid ${gridSize}×${gridSize} · "${kw}" · center ${geo.lat},${geo.lng} · ±${radiusMiles}mi · ${pins.length} pins`);

  const results = [];
  let fetchOk = 0;
  for (const p of pins) {
    let rank = null, found = false, note = null;
    if (live) {
      const url = `https://www.google.com/maps/search/${encodeURIComponent(kw)}/@${p.lat},${p.lng},13z`;
      const r = await stealthFetch(url);
      if (r.ok) { fetchOk++; const names = parseMapNames(r.html); const idx = names.findIndex((n) => business && n.toLowerCase().includes(business)); rank = idx >= 0 ? idx + 1 : null; found = idx >= 0; }
      else note = r.note;
      await sleep(1500 + Math.floor((p.row * 7 + p.col * 13) % 1500)); // jittered politeness
    }
    results.push({ ...p, rank, found, note });
  }

  const score = scoreGrid(results);
  const map = heatmap(results, gridSize);
  const liveNote = live && fetchOk === 0 ? '\n\n> ⚠️ No pins fetched — the stealth sidecar (Python+Scrapling) returned nothing. Geo-grid needs `pip install "scrapling[fetchers]"` AND realistically a residential IP (datacenter IPs get blocked/blank Maps). Run on the Mac Mini. Grid + scoring are correct; only the live ranks are missing.' : '';
  const L = [`# Geo-grid map-pack rank — ${cfg.brand}`, `"${kw}" · ${gridSize}×${gridSize} · ±${radiusMiles}mi · ${nowIso()}`, '',
    `**ATRP ${score.atrp}** (avg rank, lower better) · **SoLV ${score.solv}%** (pins in top 3) · top-10 ${score.top10Pct}% · coverage ${score.coverage}%`, '',
    '```', map, '```', liveNote];

  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `geogrid-${kw.replace(/[^a-z0-9]+/gi, '-')}.md`), L.join('\n'));
  writeFileSync(join(dir, `geogrid-${kw.replace(/[^a-z0-9]+/gi, '-')}.json`), JSON.stringify({ client: cfg.name, ranAt: nowIso(), keyword: kw, gridSize, radiusMiles, center: { lat: geo.lat, lng: geo.lng }, score, fetchOk, results }, null, 2));

  log(`\n  ATRP ${score.atrp} · SoLV ${score.solv}% · coverage ${score.coverage}% (${fetchOk}/${pins.length} pins fetched)`);
  log(map);
  log(`  → ${join(dir, `geogrid-${kw.replace(/[^a-z0-9]+/gi, '-')}.md`)}\n`);
  return { keyword: kw, score, results, fetchOk };
}
