// seo-bot · measure/prompts — generate a balanced AI-visibility prompt panel from a
// client config (brand / competitors / treatments / locations). This is the question
// set we drive through the real consumer apps (via measure.mjs → track.mjs on the Mac).
//
// Mix targets (Epic 13 / D7): the panel is NOT brand-vanity. ~30-40% unbranded category
// ("best {treatment} in {city}") because that is where buyers actually start; ~30-40%
// comparison ("{brand} vs {competitor}", "alternatives to {competitor}") because that is
// where a recommendation is won or lost; ~20-30% use-case / informational (the top of the
// funnel that feeds the rest); a few branded (does the engine even know us?).
//
// Each prompt is tagged { funnelStage, geo } so sov.mjs can slice Share-of-Voice by stage
// and geo, and work-order.mjs can prioritize the high-intent (comparison/category) gaps.
//
// NOTE (Mac-only): generating the panel is pure + cheap and runs anywhere. ACTUALLY
// driving the engines over the panel happens only on the Mac Mini via measure.mjs — do
// not scrape from here.

/** Funnel stages, ordered top→bottom. Comparison + category are the money stages. */
export const FUNNEL_STAGES = ['informational', 'category', 'comparison', 'branded'];

/** De-dupe + trim a list of strings (case-insensitive). */
function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Pull the treatment/service vocabulary out of a config (services + tracking keywords). */
function treatmentsOf(cfg) {
  const fromServices = cfg.services || [];
  const fromTracking = cfg.tracking?.keywords || [];
  const t = uniq([...fromServices, ...fromTracking]);
  // Sensible vertical fallback so the panel is never empty for a med-spa with a thin config.
  if (!t.length && cfg.vertical === 'medspa') return ['botox', 'lip filler', 'laser hair removal', 'microneedling', 'CoolSculpting'];
  return t;
}

/** Pull geo labels (cities) out of a config (locations[].nap.city, else legacy single city). */
function geosOf(cfg) {
  const fromLocations = (cfg.locations || []).map((l) => l?.nap?.city).filter(Boolean);
  const legacy = cfg.city || cfg.listings?.canonicalNap?.city || null;
  const g = uniq([...fromLocations, ...(legacy ? [legacy] : [])]);
  return g; // may be empty — category prompts then run without a geo qualifier
}

/** A single panel entry. text is what the engine sees; the rest are tags for slicing. */
function entry(text, funnelStage, { geo = null, treatment = null, competitor = null } = {}) {
  return { text: text.replace(/\s+/g, ' ').trim(), funnelStage, geo, treatment, competitor };
}

/**
 * Build a 25-50 prompt panel from a config.
 *
 * Composition (targets, not hard quotas — small configs degrade gracefully):
 *   - category     ~30-40%  unbranded "best {treatment} in {city}" / "{treatment} near me"
 *   - comparison   ~30-40%  "{brand} vs {competitor}", "alternatives to {competitor}"
 *   - informational ~20-30% use-case / how / safety / cost
 *   - branded      a few    "is {brand} good?", "{brand} reviews"
 *
 * @param {object} cfg loaded client config
 * @param {object} [o]
 * @param {number} [o.min=25] floor on panel size
 * @param {number} [o.max=50] ceiling on panel size
 * @returns {{ panel: Array<{text,funnelStage,geo,treatment,competitor}>, prompts: string[], mix: object }}
 */
export function buildPromptPanel(cfg, { min = 25, max = 50 } = {}) {
  const brand = cfg.brand || cfg.domain || 'the business';
  const competitors = uniq(cfg.competitors || []);
  const treatments = treatmentsOf(cfg);
  const geos = geosOf(cfg);
  const geoOrNull = geos.length ? geos : [null];

  const category = [];
  const comparison = [];
  const informational = [];
  const branded = [];

  // ---- category (unbranded, highest commercial intent) -------------------
  for (const t of treatments) {
    for (const g of geoOrNull) {
      category.push(entry(g ? `best ${t} in ${g}` : `best ${t} near me`, 'category', { geo: g, treatment: t }));
    }
    // one near-me variant per treatment even when geos exist (different retrieval pattern)
    if (geos.length) category.push(entry(`${t} near me`, 'category', { treatment: t }));
    category.push(entry(`who offers ${t}${geos[0] ? ` in ${geos[0]}` : ''}`, 'category', { geo: geos[0] || null, treatment: t }));
  }

  // ---- comparison (where the recommendation is won/lost) -----------------
  for (const c of competitors) {
    comparison.push(entry(`${brand} vs ${c}`, 'comparison', { competitor: c }));
    comparison.push(entry(`alternatives to ${c}${geos[0] ? ` in ${geos[0]}` : ''}`, 'comparison', { competitor: c, geo: geos[0] || null }));
  }
  if (treatments[0]) {
    comparison.push(entry(`what is the best place for ${treatments[0]}${geos[0] ? ` in ${geos[0]}` : ''}`, 'comparison', { treatment: treatments[0], geo: geos[0] || null }));
  }

  // ---- informational / use-case (top of funnel) -------------------------
  for (const t of treatments.slice(0, 6)) {
    informational.push(entry(`how much does ${t} cost${geos[0] ? ` in ${geos[0]}` : ''}`, 'informational', { treatment: t, geo: geos[0] || null }));
    informational.push(entry(`is ${t} safe`, 'informational', { treatment: t }));
  }
  if (treatments[0]) informational.push(entry(`how to choose a provider for ${treatments[0]}`, 'informational', { treatment: treatments[0] }));

  // ---- branded (does the engine know us at all?) ------------------------
  branded.push(entry(`is ${brand} a good med spa`, 'branded'));
  branded.push(entry(`${brand} reviews`, 'branded'));
  if (geos[0]) branded.push(entry(`tell me about ${brand} in ${geos[0]}`, 'branded', { geo: geos[0] }));

  // ---- proportional assembly toward the target mix ----------------------
  // Interleave by stage so a too-large raw set is trimmed to a *balanced* panel, not just
  // "all the category prompts." Target weights sum to 1.
  const buckets = [
    { stage: 'category', items: uniqEntries(category), weight: 0.35 },
    { stage: 'comparison', items: uniqEntries(comparison), weight: 0.35 },
    { stage: 'informational', items: uniqEntries(informational), weight: 0.22 },
    { stage: 'branded', items: uniqEntries(branded), weight: 0.08 },
  ];

  // Cap each bucket to its share of `max`, then fill any shortfall from the richest buckets.
  let panel = [];
  for (const b of buckets) panel.push(...b.items.slice(0, Math.max(1, Math.round(max * b.weight))));
  panel = uniqEntries(panel);

  // Top up to `min` from leftovers (category → comparison → informational) if we are short.
  if (panel.length < min) {
    const have = new Set(panel.map((p) => p.text.toLowerCase()));
    for (const b of buckets) {
      for (const it of b.items) {
        if (panel.length >= min) break;
        if (!have.has(it.text.toLowerCase())) { panel.push(it); have.add(it.text.toLowerCase()); }
      }
    }
  }
  panel = panel.slice(0, max);

  const mix = panel.reduce((m, p) => { m[p.funnelStage] = (m[p.funnelStage] || 0) + 1; return m; }, {});
  return { panel, prompts: panel.map((p) => p.text), mix };
}

/** De-dupe entries by text (keeps first/tag-richest). */
function uniqEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const k = e.text.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/**
 * Suggested R (repeats per prompt) and a noise-floor for an engine, given per-engine
 * sample-size targets for a ±~5pp CI. AI answers are non-deterministic; one run is noise.
 * (Gemini ~40-50, Perplexity ~90-100, SearchGPT ≥150 total samples per metric.)
 * Returns the per-PROMPT repeat count needed to hit that TOTAL across `promptCount` prompts.
 */
export const ENGINE_SAMPLE_TARGETS = {
  gemini: { samples: 45, noiseFloorPct: 7 },
  google_aio: { samples: 45, noiseFloorPct: 7 },
  perplexity: { samples: 95, noiseFloorPct: 5 },
  searchgpt: { samples: 150, noiseFloorPct: 5 },
  chatgpt: { samples: 150, noiseFloorPct: 5 },
  default: { samples: 60, noiseFloorPct: 6 },
};

/** Repeats-per-prompt for an engine to reach its total-sample target over `promptCount`. */
export function repeatsForEngine(engine, promptCount) {
  const t = ENGINE_SAMPLE_TARGETS[engine] || ENGINE_SAMPLE_TARGETS.default;
  if (!promptCount) return 1;
  return Math.max(1, Math.ceil(t.samples / promptCount));
}
