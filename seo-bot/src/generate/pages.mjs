// seo-bot · generate/pages — THE P0 page generator (the #1 gap: the bot could audit/fix
// pages but not GENERATE the directory's data-moat pages at scale). Reads the real spa
// dataset (data/all-spas.json, ~18.6k spas) and emits "Best Med Spas in [City]" listicle
// pages — the exact format LLMs lift for local intent — from REAL data only (ranked spas,
// real ratings/reviews/addresses, city stats), with ItemList + MedicalBusiness JSON-LD and
// an answer-first capsule. Every page is gated by index-discipline.decideIndex (thin cities
// → skip) so the batch can't trip the scaled-content-abuse demotion. Pure builders are
// unit-tested; output is written for human review (never auto-published — YMYL).

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { slugify, nowIso } from '../util.mjs';
import { decideIndex } from '../index-discipline.mjs';

/** De-duplicate spa rows (the raw dataset has repeats) by slug, else name+address. */
export function dedupeSpas(spas = []) {
  const seen = new Set(), out = [];
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const s of spas) {
    // Same business = same name + address. Do NOT key on phone (it varies/goes missing across
    // dupe rows, so including it lets the same spa survive twice) or slug (also varies).
    const k = `${norm(s.name)}|${norm(s.address)}`;
    if (!norm(s.name) || seen.has(k)) continue;
    seen.add(k); out.push(s);
  }
  return out;
}

/** Rank spas by a quality score: rating × log10(reviews) (+ a small msd_score nudge). */
export function rankSpas(spas = []) {
  return spas.filter((s) => (s.rating || 0) > 0)
    .map((s) => ({ ...s, _score: (s.rating || 0) * Math.log10((s.review_count || 0) + 1) + (s.msd_score || 0) * 0.1 }))
    .sort((a, b) => b._score - a._score);
}

/** Real, quotable city stats (the Information-Gain citation magnet). */
export function cityStats(spas = []) {
  const rated = spas.filter((s) => (s.rating || 0) > 0);
  const avgRating = rated.length ? Math.round((rated.reduce((x, s) => x + s.rating, 0) / rated.length) * 10) / 10 : 0;
  const totalReviews = spas.reduce((x, s) => x + (s.review_count || 0), 0);
  const prices = spas.map((s) => s.price_range).filter(Boolean);
  const priceMode = prices.sort((a, b) => prices.filter((v) => v === a).length - prices.filter((v) => v === b).length).pop() || null;
  return { count: spas.length, rated: rated.length, avgRating, totalReviews, priceMode };
}

/** Build ONE "Best Med Spas in {city}" listicle page spec from real spa rows. Pure. */
export function buildCityListicle(city, state, spas, { topN = 10 } = {}) {
  const dd = dedupeSpas(spas);
  const ranked = rankSpas(dd);
  const stats = cityStats(dd);
  const top = ranked.slice(0, topN);
  const slug = slugify(`best-med-spas-${city}-${state}`);
  const title = `Best Med Spas in ${city}, ${state} (2026) — Top ${top.length}, Ranked`;
  const answerCapsule = `${city}, ${state} has ${stats.count} med spas${stats.rated ? `; the rated ones average ${stats.avgRating}★ across ${stats.totalReviews.toLocaleString()} reviews` : ''}. Below are the ${top.length} best, ranked by rating and review volume.`;
  const md = [`# ${title}`, '', answerCapsule, ''];
  top.forEach((s, i) => {
    md.push(`## ${i + 1}. ${s.name} — ${s.rating}★ (${(s.review_count || 0).toLocaleString()} reviews)`);
    md.push([s.address, s.price_range, s.phone].filter(Boolean).join(' · ') || '_details on profile_');
    if (s.services?.length) md.push(`Services: ${s.services.slice(0, 6).join(', ')}`);
    md.push('');
  });
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'ItemList', name: title, numberOfItems: top.length,
    itemListElement: top.map((s, i) => ({
      '@type': 'ListItem', position: i + 1,
      item: {
        '@type': 'MedicalBusiness', name: s.name,
        address: { '@type': 'PostalAddress', streetAddress: s.address || undefined, addressLocality: city, addressRegion: state, postalCode: s.zip || undefined },
        ...(s.rating ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: s.rating, reviewCount: s.review_count || 0 } } : {}),
        ...(s.phone ? { telephone: s.phone } : {}),
        ...(s.website ? { url: s.website } : {}),
        ...(s.price_range ? { priceRange: s.price_range } : {}),
      },
    })),
  };
  return { slug, title, answerCapsule, items: top, stats, markdown: md.join('\n'), jsonLd };
}

/** Build a "{city} Med Spa Stats & Pricing" page — proprietary aggregate data = an
 *  Information-Gain citation magnet (the stat blocks LLMs quote). Pure. */
export function buildCityStats(city, state, spas) {
  const dd = dedupeSpas(spas);
  const s = cityStats(dd);
  const ranked = rankSpas(dd);
  const ratingBands = { '4.5★+': dd.filter((x) => x.rating >= 4.5).length, '4.0–4.4★': dd.filter((x) => x.rating >= 4 && x.rating < 4.5).length, 'under 4.0★': dd.filter((x) => x.rating > 0 && x.rating < 4).length };
  const priceDist = {}; for (const x of dd) if (x.price_range) priceDist[x.price_range] = (priceDist[x.price_range] || 0) + 1;
  const slug = slugify(`med-spa-stats-${city}-${state}`);
  const title = `${city}, ${state} Med Spa Statistics & Pricing (2026)`;
  const answerCapsule = `${city}, ${state} has ${s.count} med spas averaging ${s.avgRating}★ across ${s.totalReviews.toLocaleString()} reviews. ${ratingBands['4.5★+']} rate 4.5★ or higher${s.priceMode ? `; the most common price tier is ${s.priceMode}` : ''}.`;
  const md = [`# ${title}`, '', answerCapsule, '', '## Spas by rating',
    ...Object.entries(ratingBands).map(([k, v]) => `- ${k}: ${v} spas`), '', '## Spas by price tier',
    ...Object.entries(priceDist).sort().map(([k, v]) => `- ${k}: ${v} spas`), '', '## Highest-rated (by rating × review volume)',
    ...ranked.slice(0, 5).map((x, i) => `${i + 1}. ${x.name} — ${x.rating}★ (${(x.review_count || 0).toLocaleString()} reviews)`)].join('\n');
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Dataset', name: title, description: answerCapsule, creator: { '@type': 'Organization', name: 'med-spa directory' }, variableMeasured: ['spa count', 'average rating', 'total reviews', 'price tier distribution'] };
  return { slug, title, answerCapsule, stats: s, ratingBands, priceDist, markdown: md, jsonLd };
}

/** Build an objective "{A} vs {B}" comparison page from real listing data (factual + a
 *  verify-with-provider disclaimer; never self-rank, never fabricate claims). Pure. */
export function buildComparison(a, b, { city = '', state = '' } = {}) {
  const slug = slugify(`${a.name}-vs-${b.name}-${city}`);
  const title = `${a.name} vs ${b.name}${city ? ` in ${city}, ${state}` : ''} — Honest Comparison (2026)`;
  const answerCapsule = `${a.name} and ${b.name} are both top-rated med spas${city ? ` in ${city}` : ''}. ${a.name}: ${a.rating}★ across ${(a.review_count || 0).toLocaleString()} reviews. ${b.name}: ${b.rating}★ across ${(b.review_count || 0).toLocaleString()} reviews.`;
  const rows = [['Rating', `${a.rating}★`, `${b.rating}★`], ['Reviews', (a.review_count || 0).toLocaleString(), (b.review_count || 0).toLocaleString()], ['Price tier', a.price_range || '—', b.price_range || '—'], ['Address', a.address || '—', b.address || '—'], ['Services', (a.services || []).slice(0, 4).join(', ') || '—', (b.services || []).slice(0, 4).join(', ') || '—']];
  const md = [`# ${title}`, '', answerCapsule, '', `| | ${a.name} | ${b.name} |`, '|---|---|---|', ...rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`), '', '_Comparison built from public listing data; confirm current pricing and availability with each provider._'].join('\n');
  return { slug, title, answerCapsule, markdown: md };
}

function loadSpas(cfg) {
  const path = cfg.spaDataFile ? join(ROOT, cfg.spaDataFile) : join(ROOT, 'data', 'all-spas.json');
  if (!existsSync(path)) return null;
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; } // corrupt dataset → same graceful "not found" path as a missing one, never a crash mid-batch
  return Array.isArray(raw) ? raw : (raw.spas || raw.data || []);
}

export async function generatePages(cfg, { log = () => {}, minSpas = 5, max = 50 } = {}) {
  const spas = loadSpas(cfg);
  if (!spas?.length) return { error: `spa dataset not found (set cfg.spaDataFile; default data/all-spas.json)` };
  // group by city|state
  const byCity = new Map();
  for (const s of spas) { if (!s.city || !s.state) continue; const k = `${s.city}|${s.state}`; (byCity.get(k) || byCity.set(k, []).get(k)).push(s); }

  // core-update freeze (don't ship a programmatic batch mid-rollout)
  let coreUpdateActive = false;
  try { const { googleUpdates } = await import('../updates.mjs'); coreUpdateActive = (await googleUpdates({ log: () => {} })).coreUpdateActive; } catch { /* */ }

  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name, 'generated');
  mkdirSync(dir, { recursive: true });
  const generated = [], skipped = [];
  const cities = [...byCity.entries()].sort((a, b) => b[1].length - a[1].length); // densest first
  for (const [key, cityspas] of cities) {
    if (generated.length >= max) break;
    const [city, state] = key.split('|');
    const deduped = dedupeSpas(cityspas);
    const stats = cityStats(deduped);
    // hasUniqueData must be EARNED: real aggregate review data, not just a list of names.
    const hasUniqueData = stats.rated >= 3 && stats.totalReviews > 0;
    const decision = decideIndex({ url: `/best-med-spas/${slugify(city + '-' + state)}`, hasUniqueData, listings: deduped.length, reviews: stats.totalReviews, coreUpdateActive }, { minListings: minSpas });
    if (decision.action !== 'index') { skipped.push({ city: key, reason: decision.reason }); continue; }
    const page = buildCityListicle(city, state, deduped);
    writeFileSync(join(dir, `${page.slug}.md`), page.markdown + '\n\n```json\n' + JSON.stringify(page.jsonLd, null, 2) + '\n```\n');
    writeFileSync(join(dir, `${page.slug}.jsonld.json`), JSON.stringify(page.jsonLd, null, 2));
    const statsPage = buildCityStats(city, state, deduped); // proprietary-data citation magnet
    writeFileSync(join(dir, `${statsPage.slug}.md`), statsPage.markdown + '\n\n```json\n' + JSON.stringify(statsPage.jsonLd, null, 2) + '\n```\n');
    const top2 = rankSpas(deduped).slice(0, 2); // top spa vs runner-up comparison
    let cmpSlug = null;
    if (top2.length === 2) { const cmp = buildComparison(top2[0], top2[1], { city, state }); cmpSlug = cmp.slug; writeFileSync(join(dir, `${cmp.slug}.md`), cmp.markdown + '\n'); }
    generated.push({ slug: page.slug, statsSlug: statsPage.slug, comparisonSlug: cmpSlug, city: key, spas: deduped.length, reviews: stats.totalReviews });
  }
  writeFileSync(join(dir, '_manifest.json'), JSON.stringify({ client: cfg.name, ranAt: nowIso(), generated, skipped: skipped.length, coreUpdateActive }, null, 2));
  log(`\n  Generated ${generated.length} city-listicle pages (≥${minSpas} spas each) · ${skipped.length} thin cities skipped (noindex)${coreUpdateActive ? ' · ⚠ CORE UPDATE — would hold publish' : ''}`);
  if (generated[0]) log(`  e.g. ${generated[0].slug} (${generated[0].spas} spas, ${generated[0].reviews.toLocaleString()} reviews)`);
  log(`  → ${dir} (review, then publish via apply)\n`);
  return { generated, skipped: skipped.length, coreUpdateActive };
}
