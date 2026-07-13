// seo-bot · generate/moat — E4 data-moat pages: the June-2026 spam-update SURVIVOR
// pattern (unique per-page REAL data, human-reviewed before publish; see
// research/spam-update-impact-2026 in the KB). Builds /cost/[service]/[city] page
// plans where EVERY number is computed from dataset rows — price-TIER p25–p75
// (the dataset has tier strings, never dollar figures, so no dollar figure is ever
// rendered), provider count, review-count distribution, top-rated share — and each
// dataPoint carries row-ref provenance (which dataset entries produced the number).
//
// HARD REFUSALS (fail-closed):
//   · a page with <3 real computed aggregate dataPoints → rejected (local-value)
//   · any rendered number not derivable from the dataPoints → rejected
//     (gates.mjs no-fabrication is the authority — the same gate the content path uses)
//   · plan volume rides the existing plan-cap (capProgrammatic, June-2026 guard)
//   · emission rides the existing publish-throttle (throttlePublish)
//   · every rendered draft goes through the originality gate with its siblings as
//     priorTexts, PLUS a stricter sibling-similarity cap (template siblings must be
//     far more distinct than the generic 0.86 — city-swap near-duplicates die here)
//   · compliance failures (banned claims / GLP-1 brand copy) → rejected, human queue
//
// Nothing here publishes. Output = plans + sample drafts under reports/<client>/moat/;
// publishing rides the existing gated content path (score → human approve → PR).
// Deterministic, zero LLM calls.

import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { slugify, nowIso } from '../util.mjs';
import { dedupeSpas, rankSpas } from './pages.mjs';
import { scoreContent as gateContent } from '../content/gates.mjs';
import { capProgrammatic, throttlePublish } from '../content/index.mjs';

const TIERS = ['$', '$$', '$$$', '$$$$'];
const MIN_AGGREGATES = 3;     // local-value: a page needs >=3 real computed aggregates
const MIN_ROWS_FOR_STAT = 3;  // an aggregate computed from <3 rows is not a real stat
// Template siblings must be MUCH more distinct than the global 0.86 originality cap:
// a pure city-swap of this template measures ~0.5 raw similarity (only the city tokens
// change), which the generic gate would pass. Siblings are therefore ALSO compared
// after normalizing the template variables (city/state/service → placeholders): a pure
// swap then measures ~1.0 while genuinely distinct data stays well under 0.2, so the
// 0.5 cap has wide margins on both sides. Configurable but clamped so it can NEVER be
// weaker than the global 0.86 gate.
const DEFAULT_MAX_SIBLING_SIM = 0.5;
// Generic directory labels that are not a bookable service (never plan a page for these).
const GENERIC_SERVICES = new Set(['medical spa', 'aesthetics', 'spa', 'day spa', 'medical clinic', 'wellness center', 'massage spa', 'facial spa', 'prime', 'dermatology', 'plastic surgery']);

/** Linear-interpolation percentile (type-7). Fail-closed: non-finite values are
 *  dropped; an empty/invalid sample returns null (never NaN). p is clamped to [0,1]. */
export function percentile(values = [], p = 0.5) {
  const v = (Array.isArray(values) ? values : []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length || !Number.isFinite(p)) return null;
  const q = Math.min(1, Math.max(0, p));
  const idx = q * (v.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? v[lo] : v[lo] + (idx - lo) * (v[hi] - v[lo]);
}

/** Row-ref provenance: enough to find the exact dataset entry again. */
function refOf(row) { return { i: Number.isFinite(row?._i) ? row._i : null, name: row?.name || null, slug: row?.slug || null }; }

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Compute the real dataPoints for ONE service×city page from the deduped rows that
 * offer the service. Every dataPoint = { id, kind:'aggregate'|'provider', label,
 * value, rows:[refs], method }. Numbers appear in `label` verbatim — the label set is
 * exactly what the no-fabrication gate later allows, so nothing else can be rendered.
 */
export function computeDataPoints(rows = [], { service = '', city = '', state = '' } = {}) {
  const out = [];
  const n = rows.length;
  if (!n) return out;

  // 1) provider count — every offering row contributes.
  out.push({ id: 'provider-count', kind: 'aggregate', value: n,
    label: `${n} providers offer ${service} in ${city}, ${state}`,
    rows: rows.map(refOf), method: 'count of deduplicated listings offering the service' });

  // 2) review-count distribution (p25–p75 + median) — reviewed rows only, >=3 required.
  const reviewed = rows.filter((r) => Number.isFinite(r.review_count) && r.review_count > 0);
  if (reviewed.length >= MIN_ROWS_FOR_STAT) {
    const counts = reviewed.map((r) => r.review_count);
    const p25 = Math.round(percentile(counts, 0.25));
    const p75 = Math.round(percentile(counts, 0.75));
    const med = Math.round(percentile(counts, 0.5));
    out.push({ id: 'review-range', kind: 'aggregate', value: { p25, p75, median: med },
      label: `Review counts for ${service} providers in ${city} run ${p25} to ${p75} per provider (25th–75th percentile across ${reviewed.length} reviewed providers; median ${med})`,
      rows: reviewed.map(refOf), method: 'linear-interpolation percentiles of review_count over reviewed listings' });
    const total = counts.reduce((s, x) => s + x, 0);
    out.push({ id: 'total-reviews', kind: 'aggregate', value: total,
      label: `${service} providers in ${city} have accumulated ${total.toLocaleString()} patient reviews in total across ${reviewed.length} providers with reviews`,
      rows: reviewed.map(refOf), method: 'sum of review_count over reviewed listings' });
  }

  // 3) rating aggregates — rated rows only, >=3 required.
  const rated = rows.filter((r) => Number.isFinite(r.rating) && r.rating > 0);
  if (rated.length >= MIN_ROWS_FOR_STAT) {
    const avg = round1(rated.reduce((s, r) => s + r.rating, 0) / rated.length);
    out.push({ id: 'avg-rating', kind: 'aggregate', value: avg,
      label: `Rated ${service} providers in ${city} average ${avg}★ (${rated.length} rated providers)`,
      rows: rated.map(refOf), method: 'mean rating over rated listings, 1 decimal' });
    const share = Math.round((rated.filter((r) => r.rating >= 4.5).length / rated.length) * 100);
    out.push({ id: 'top-rated-share', kind: 'aggregate', value: share,
      label: `${share}% of the ${rated.length} rated ${service} providers in ${city} hold a 4.5★ rating or higher`,
      rows: rated.map(refOf), method: 'share of rated listings with rating >= 4.5' });
  }

  // 4) price-TIER p25–p75 — tier strings mapped to levels; the dataset has NO dollar
  //    figures, so no dollar figure is ever computed or rendered (no-fabrication).
  const priced = rows.filter((r) => TIERS.includes(r.price_range));
  if (priced.length >= MIN_ROWS_FOR_STAT) {
    const levels = priced.map((r) => TIERS.indexOf(r.price_range) + 1);
    const lo = TIERS[Math.round(percentile(levels, 0.25)) - 1];
    const hi = TIERS[Math.round(percentile(levels, 0.75)) - 1];
    const range = lo === hi ? lo : `${lo}–${hi}`;
    out.push({ id: 'price-tier-range', kind: 'aggregate', value: { lo, hi },
      label: `Typical listed price tier for ${service} in ${city}: ${range} (25th–75th percentile of ${priced.length} listed price tiers)`,
      rows: priced.map(refOf), method: 'percentiles over listed price-tier levels ($ .. $$$$); tiers, never dollar amounts' });
  }

  // 5) top providers (comparison-table rows) — each carries its own row provenance so
  //    every rating/review number/address in the table is a sourced dataPoint.
  for (const p of rankSpas(rows).slice(0, 5)) {
    out.push({ id: `provider:${slugify(p.name)}`, kind: 'provider',
      value: { name: p.name, rating: round1(p.rating), reviews: p.review_count || 0, tier: TIERS.includes(p.price_range) ? p.price_range : null, address: p.address || '' },
      label: `${p.name} — ${round1(p.rating)}★ across ${(p.review_count || 0).toLocaleString()} reviews${p.address ? ` (${p.address}, ${city})` : ''}`,
      rows: [refOf(p)], method: 'listing fields verbatim (rating, review_count, address, price_range)' });
  }
  return out;
}

/** Dataset-derived candidate services when the config names none (generic labels excluded). */
export function topDatasetServices(rows = [], max = 5) {
  const tally = new Map();
  for (const r of rows) for (const s of r.services || []) {
    const k = String(s).trim(); if (!k || GENERIC_SERVICES.has(k.toLowerCase())) continue;
    tally.set(k, (tally.get(k) || 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
}

/**
 * Build the /cost/[service]/[city] plan from a dataset. Pure (dataset passed in).
 * Plan volume is routed through the existing plan-cap (capProgrammatic) — injectable
 * as `capFn` so tests can spy. Returns { plan, rejected, cap:{dropped,max} }.
 */
export function buildMoatPlan(cfg = {}, dataset = [], { service = null, city = null, capFn = capProgrammatic } = {}) {
  const rows = (Array.isArray(dataset) ? dataset : [])
    .map((r, i) => ({ ...r, _i: i }))
    .filter((r) => r && r.name && r.city && r.state);
  const wantCity = city ? String(city).toLowerCase() : null;

  const byCity = new Map();
  for (const r of rows) {
    if (wantCity && String(r.city).toLowerCase() !== wantCity) continue;
    const k = `${r.city}|${r.state}`;
    if (!byCity.has(k)) byCity.set(k, []);
    byCity.get(k).push(r);
  }

  const cfgServices = (cfg.services || []).map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean);
  const services = service ? [String(service)] : cfgServices.length ? cfgServices : topDatasetServices(rows);

  let plan = [];
  const rejected = [];
  const cities = [...byCity.entries()].sort((a, b) => b[1].length - a[1].length); // densest first
  for (const [key, cityRows] of cities) {
    const [cityName, stateName] = key.split('|');
    const deduped = dedupeSpas(cityRows);
    for (const svc of services) {
      const offering = deduped.filter((r) => (r.services || []).some((s) => String(s).toLowerCase() === svc.toLowerCase()));
      if (!offering.length) continue; // no such page candidate at all
      const dataPoints = computeDataPoints(offering, { service: svc, city: cityName, state: stateName });
      const aggregates = dataPoints.filter((d) => d.kind === 'aggregate');
      const slug = slugify(`cost-${svc}-${cityName}-${stateName}`);
      const url = `/cost/${slugify(svc)}/${slugify(`${cityName}-${stateName}`)}`;
      if (aggregates.length < MIN_AGGREGATES) {
        // HARD REFUSAL: local-value — a city token plus a name list is not local value.
        rejected.push({ slug, url, service: svc, city: cityName, state: stateName, reason: 'local-value',
          detail: `only ${aggregates.length} real computed dataPoints (<${MIN_AGGREGATES}) — not enough unique per-page data to justify a page` });
        continue;
      }
      plan.push({
        slug, url, service: svc, city: cityName, state: stateName,
        targetQuery: `${svc.toLowerCase()} cost ${cityName.toLowerCase()}`,
        title: `${svc} Cost ${cityName}, ${stateName} (2026): Price Tiers & Provider Data`,
        local: true, ymyl: true, dataPoints,
      });
    }
  }

  // June-2026 guard: plan volume rides the existing plan-cap.
  const max = cfg.content?.maxProgrammaticPages ?? 200;
  const capped = capFn(plan, max);
  return { plan: capped.plan, rejected, cap: { dropped: capped.dropped, max } };
}

/** The answer capsule (40–60 words, numbers only from dataPoint labels). */
function buildCapsule(plan) {
  const dp = (id) => (plan.dataPoints || []).find((d) => d.id === id) || null;
  const s = [];
  const pc = dp('provider-count');
  if (pc) s.push(`${plan.city}, ${plan.state} directory data lists ${pc.value} providers offering ${plan.service}.`);
  const avg = dp('avg-rating'), tot = dp('total-reviews'), share = dp('top-rated-share');
  if (avg && tot && share) s.push(`Rated providers average ${avg.value}★ across ${tot.value.toLocaleString()} total patient reviews, and ${share.value}% hold a 4.5★ rating or higher.`);
  const rr = dp('review-range'), pt = dp('price-tier-range');
  if (rr && pt) s.push(`Review counts generally run ${rr.value.p25} to ${rr.value.p75} per provider, and the typical listed price tier ranges around ${pt.value.lo === pt.value.hi ? pt.value.lo : `${pt.value.lo}–${pt.value.hi}`}.`);
  return s.join(' ');
}

/**
 * Render ONE moat page plan to a markdown draft. Deterministic; every number comes
 * from a dataPoint label (the aggregate labels ARE the prose), so the no-fabrication
 * gate holds by construction. Structure: answer capsule up top, comparison table,
 * question H2s, methodology/provenance, non-promotional tone, Dataset JSON-LD.
 */
export function renderMoatPage(plan) {
  if (!plan || !Array.isArray(plan.dataPoints)) return '';
  const dp = (id) => plan.dataPoints.find((d) => d.id === id) || null;
  const providers = plan.dataPoints.filter((d) => d.kind === 'provider');
  const { service, city } = plan;
  const L = [`# ${plan.title}`, '', buildCapsule(plan), ''];

  L.push(`## How many providers offer ${service} in ${city}?`, '');
  const pc = dp('provider-count'), tot = dp('total-reviews');
  if (pc) L.push(`${pc.label}.`);
  if (tot) L.push(`${tot.label}.`);
  L.push('');

  if (providers.length) {
    L.push(`## How do ${city} ${service} providers compare?`, '');
    L.push('| Provider | Rating | Reviews | Price tier | Address |', '|---|---|---|---|---|');
    for (const p of providers) {
      const v = p.value;
      L.push(`| ${v.name} | ${v.rating}★ | ${v.reviews.toLocaleString()} | ${v.tier || '—'} | ${v.address || '—'} |`);
    }
    L.push('', '_Providers ranked by rating and review volume, directly from public directory listings. Confirm current availability and pricing with each provider._', '');
  }

  L.push(`## How much does ${service} cost? ${city} provider data`, '');
  const pt = dp('price-tier-range');
  if (pt) L.push(`${pt.label}.`);
  L.push(`Price tiers reflect each provider's listed bracket on public directories, not a quoted treatment price. A consultation quote depends on the treatment area and plan, so confirm current pricing directly with the provider.`, '');

  const rr = dp('review-range'), avg = dp('avg-rating'), share = dp('top-rated-share');
  L.push(`## What do reviews say about ${service} providers in ${city}?`, '');
  if (rr) L.push(`${rr.label}.`);
  if (avg) L.push(`${avg.label}.`);
  if (share) L.push(`${share.label}.`);
  L.push('');

  L.push('## How were these numbers computed?', '');
  L.push(`Every figure on this page is computed directly from deduplicated public directory listings for ${city} — nothing is estimated, projected, or invented. The statistics behind this page:`, '');
  for (const d of plan.dataPoints.filter((x) => x.kind === 'aggregate')) L.push(`- ${d.label}`);
  L.push('', 'Row-level provenance for each statistic is stored alongside this draft for review.', '');

  const jsonLd = { '@context': 'https://schema.org', '@type': 'Dataset', name: plan.title, description: buildCapsule(plan), variableMeasured: ['provider count', 'review-count distribution', 'top-rated share', 'price tier range'] };
  L.push(`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`, '');
  return L.join('\n');
}

/** Deterministic term set for content/score.mjs (no competitor corpus needed). */
export function moatTerms(plan) {
  const t = (term, min, max) => ({ term: String(term).toLowerCase(), n: String(term).trim().split(/\s+/).length, recommended: { min, max }, weight: 1 });
  return { query: plan.targetQuery, docCount: 0, terms: [
    t(plan.service, 2, 40), t(plan.city, 2, 40), t('cost', 1, 15), t('providers', 1, 30),
    t('reviews', 1, 30), t('price tier', 1, 15), t('rating', 1, 15),
  ] };
}

// ---- template-variable-normalized sibling similarity (mirrors gates.mjs originality
// math: 8-word shingles + jaccard) — the city-swap detector. Replacing each page's own
// template variables (city/state/service) with fixed placeholders makes a pure swap
// measure ~1.0 while genuinely distinct data pages stay far below the cap.
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function normalizeVars(text, vars = {}) {
  let t = String(text || '');
  for (const [key, ph] of [['service', ' templsvc '], ['city', ' templcity '], ['state', ' templstate ']]) {
    const v = vars[key];
    if (v) t = t.replace(new RegExp(escRe(String(v)), 'gi'), ph);
  }
  return t;
}
function shingleSet(text, k = 8) {
  const w = String(text).toLowerCase().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(' '));
  return out;
}
function jaccardSets(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Gate a rendered moat draft: the content-path originality gate runs with the page's
 * SIBLINGS as priorTexts (plus a stricter sibling cap — city-swap near-dupes die here,
 * both raw and template-variable-normalized), and the no-fabrication gate verifies
 * every rendered number traces to a dataPoint. Fail-closed: empty/short drafts fail
 * originality; compliance failures reject too (human queue only).
 * `siblings` entries: string, or { text, city, state, service } (enables the
 * normalized city-swap check — pass the structured form whenever known).
 */
export function gateMoatDraft(draft, plan, { siblings = [], reviewers = null, maxSiblingSim = DEFAULT_MAX_SIBLING_SIM } = {}) {
  // The sibling cap may be tightened but NEVER loosened past the global 0.86 gate.
  const simCap = Math.min(Number.isFinite(maxSiblingSim) ? maxSiblingSim : DEFAULT_MAX_SIBLING_SIM, 0.86);
  const sibTexts = siblings.map((s) => (typeof s === 'string' ? s : s?.text)).filter((s) => typeof s === 'string');
  const brief = {
    title: plan?.title || '', targetQuery: plan?.targetQuery || '', city: plan?.city || '',
    local: true, neighborhoods: [], schemaTypes: ['Dataset'],
    dataPoints: (plan?.dataPoints || []).map((d) => d.label),
  };
  const g = gateContent(String(draft || ''), brief, { priorTexts: sibTexts, reviewers });

  // Normalized similarity: each side normalized with ITS OWN template variables.
  const draftNorm = shingleSet(normalizeVars(draft, { city: plan?.city, state: plan?.state, service: plan?.service }));
  let simNorm = 0;
  for (const s of siblings) {
    if (typeof s === 'string' || !s?.text) continue;
    simNorm = Math.max(simNorm, jaccardSets(draftNorm, shingleSet(normalizeVars(s.text, { city: s.city, state: s.state, service: s.service }))));
  }
  simNorm = Math.round(simNorm * 100) / 100;

  const reasons = [];
  if (!g.hard['no-fabrication']) reasons.push(`no-fabrication: ${g.stats.unsourcedNumbers} number(s) in the draft are not derivable from the dataset dataPoints`);
  if (!g.hard['originality-dedup']) reasons.push(`originality: duplicate of a sibling (sim ${g.stats.maxSimilarity} >= 0.86) or draft too short to evaluate`);
  else if (g.stats.maxSimilarity > simCap) reasons.push(`sibling-similarity: ${g.stats.maxSimilarity} > ${simCap} — templated near-duplicate of a sibling page`);
  if (simNorm > simCap && !reasons.some((r) => r.startsWith('sibling-similarity') || r.startsWith('originality'))) {
    reasons.push(`sibling-similarity(normalized): ${simNorm} > ${simCap} — city/service-swap of a sibling page (same data, swapped tokens)`);
  }
  if (!g.hard['compliance']) reasons.push('compliance: banned claim / GLP-1 brand copy detected — human review queue only, never auto-published');
  return { ok: reasons.length === 0, rejected: reasons.length > 0, reasons, maxSimilarity: g.stats.maxSimilarity, normalizedSimilarity: simNorm, simCap, gate: g };
}

/** Emission schedule rides the existing publish-throttle. Injectable for test spies. */
export function scheduleEmission(slugs = [], cfg = {}, { throttleFn = throttlePublish } = {}) {
  const maxPerRun = Math.max(0, Number(cfg?.content?.maxPublishPerRun ?? 4) || 0);
  const emit = throttleFn(slugs, { maxPerRun });
  return { emit, held: slugs.slice(emit.length), maxPerRun };
}

function loadSpas(cfg) {
  const path = cfg.spaDataFile ? join(ROOT, cfg.spaDataFile) : join(ROOT, 'data', 'all-spas.json');
  if (!existsSync(path)) return null;
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; } // corrupt = missing, never a crash
  return Array.isArray(raw) ? raw : (raw.spas || raw.data || []);
}

/**
 * CLI shell: `moat <client> [--service X --city Y]` — writes plans + gated sample
 * drafts to reports/<client>/moat/. NEVER publishes; publishing rides the existing
 * gated content path (fill the brief → content score → human approve → PR).
 */
export async function runMoat(cfg, { log = () => {}, service = null, city = null } = {}) {
  const spas = loadSpas(cfg);
  if (!spas?.length) return { error: 'spa dataset not found (set cfg.spaDataFile; default data/all-spas.json)' };

  const { plan, rejected, cap } = buildMoatPlan(cfg, spas, { service: service ? String(service) : null, city: city ? String(city) : null });
  const dir = join(ROOT, 'reports', cfg.name, 'moat');
  mkdirSync(dir, { recursive: true });

  // Existing drafts on disk are siblings too — cross-run dedup, not just intra-run.
  // Pair each with its brief (city/state/service) so the normalized swap-check works.
  const siblings = [];
  try {
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('moat-plan'))) {
      const text = readFileSync(join(dir, f), 'utf-8');
      let vars = {};
      try { const b = JSON.parse(readFileSync(join(dir, f.replace(/\.md$/, '.brief.json')), 'utf-8')); vars = { city: b.city, state: b.state, service: b.service }; } catch { /* plain-text sibling */ }
      siblings.push({ text, ...vars });
    }
  } catch { /* first run */ }

  // Emission schedule rides the publish-throttle (burst emission is a SpamBrain
  // signal). Pages that already have an emitted draft are not re-scheduled, so held
  // pages get their turn on the next run instead of the same N re-rendering forever.
  const alreadyEmitted = plan.filter((p) => existsSync(join(dir, `${p.slug}.md`))).map((p) => p.slug);
  const pending = plan.map((p) => p.slug).filter((s) => !alreadyEmitted.includes(s));
  const { emit, held, maxPerRun } = scheduleEmission(pending, cfg);
  const emitSet = new Set(emit);

  const drafts = [];
  let scoreMod = null;
  try { scoreMod = await import('../content/score.mjs'); } catch { /* structural score optional */ }
  for (const p of plan) {
    if (!emitSet.has(p.slug)) continue;
    const draft = renderMoatPage(p);
    const gate = gateMoatDraft(draft, p, { siblings, reviewers: cfg.reviewers, maxSiblingSim: cfg.content?.moatMaxSiblingSim });
    let structureScore = null;
    if (scoreMod) { try { structureScore = scoreMod.scoreContent(draft, moatTerms(p)).score; } catch { structureScore = null; } }
    if (gate.rejected) {
      drafts.push({ slug: p.slug, accepted: false, reasons: gate.reasons, maxSimilarity: gate.maxSimilarity, structureScore });
      continue; // rejected drafts are never written — dead pages die here
    }
    siblings.push({ text: draft, city: p.city, state: p.state, service: p.service });
    writeFileSync(join(dir, `${p.slug}.md`), draft);
    writeFileSync(join(dir, `${p.slug}.brief.json`), JSON.stringify({
      template: 'cost_guide', local: true, title: p.title, targetQuery: p.targetQuery,
      city: p.city, state: p.state, service: p.service, neighborhoods: cfg.neighborhoods || [],
      author: { name: '', role: '' }, primarySources: [], schemaTypes: ['Dataset'], hasOwnMedia: false,
      dataPoints: p.dataPoints.map((d) => d.label), dataProvenance: p.dataPoints,
    }, null, 2));
    drafts.push({ slug: p.slug, accepted: true, maxSimilarity: gate.maxSimilarity, structureScore, pendingHuman: gate.gate.hardFails });
  }

  const manifest = { client: cfg.name, ranAt: nowIso(), planned: plan.length, rejectedPlans: rejected.length,
    cap, throttle: { emitted: emit.length, held: held.length, maxPerRun, alreadyEmitted: alreadyEmitted.length }, drafts, rejected };
  writeFileSync(join(dir, 'moat-manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'moat-plan.json'), JSON.stringify({ client: cfg.name, ranAt: nowIso(), plan, rejected }, null, 2));

  const md = [`# Data-moat plan — ${cfg.brand}`, '',
    `${plan.length} page plan(s) · ${rejected.length} rejected (no real data) · ${cap.dropped} over the plan-cap (${cap.max})`,
    `Drafts emitted this run: ${emit.length} (throttle ${maxPerRun}/run; ${held.length} held for later runs; ${alreadyEmitted.length} already emitted earlier)`, '',
    '## Planned pages', ...plan.map((p) => `- [ ] \`${p.url}\` — "${p.targetQuery}" · ${p.dataPoints.filter((d) => d.kind === 'aggregate').length} computed dataPoints · ${p.dataPoints.filter((d) => d.kind === 'provider').length} sourced providers`),
    '', '## Rejected (fail-closed)', ...(rejected.length ? rejected.map((r) => `- \`${r.url}\` — ${r.reason}: ${r.detail}`) : ['- none']),
    '', '## Next steps (human)',
    '1. Review each emitted draft + its `.brief.json` (row-level provenance included).',
    '2. Add the REAL local facts the hard local-value gate requires before publish: an actual consult price for the city and a named credentialed provider (these are not in the dataset and must never be invented).',
    '3. Fill `author` + `primarySources` in the brief, then run `content score` → `content approve` → `content publish` (PR; human merges).',
  ].join('\n');
  writeFileSync(join(dir, 'moat-plan.md'), md);

  const acc = drafts.filter((d) => d.accepted).length;
  log(`\n  Data-moat: ${plan.length} page plan(s) (${rejected.length} rejected: no real per-page data; ${cap.dropped} over plan-cap)`);
  log(`  Drafts: ${acc} emitted / ${drafts.length - acc} rejected at the gates · throttle ${emit.length}/${pending.length} pending this run (cap ${maxPerRun}; ${alreadyEmitted.length} already emitted)`);
  log(`  → ${dir} (review + enrich; publishing rides the gated content path — never automatic)\n`);
  return { plan, rejected, cap, throttle: { emitted: emit.length, held: held.length, maxPerRun, alreadyEmitted: alreadyEmitted.length }, drafts, dir };
}
