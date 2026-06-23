// seo-bot · entity/extract — NER over already-crawled RAW HTML (no JS), using a curated
// med-spa gazetteer + lightweight heuristics. AI engines ground answers on a brand's
// ENTITY, not its prose; to claim `about`/`mentions` schema (Epic 9) we first have to KNOW
// which entities a page is about. This runs offline on the HTML crawl.mjs already fetched —
// no extra fetch, no paid NER API. Brand/Org entities are resolved to Wikidata/Google-KG
// sameAs by reusing sources/entity.mjs (free).
//
// Output: a normalized entity list per page, each { type, name, canonical, synonyms[],
// role(about|mentions), count, kind } where `kind` ∈ treatment|brand|condition|profession|
// location|organization. The TOP-scoring on-topic entity becomes `about`; the rest are
// `mentions`. graph.mjs ingests these; schema-emit.mjs turns them into JSON-LD.

import * as cheerio from 'cheerio';

/* ─────────────────────────── the gazetteer ─────────────────────────────────
 * Curated, med-spa-specific. Each entry: canonical name + synonyms/aliases the
 * crawler should fold into it. Kept inline (no deps); extend per vertical. */

/** Treatments / procedures (the queries AI engines actually field for med-spas). */
const TREATMENTS = {
  'Botox': ['botox', 'botulinum toxin', 'botox injections', 'tox', 'wrinkle relaxer', 'neuromodulator', 'neurotoxin'],
  'Dysport': ['dysport'],
  'Xeomin': ['xeomin'],
  'Jeuveau': ['jeuveau', 'newtox'],
  'Dermal fillers': ['dermal filler', 'dermal fillers', 'facial filler', 'lip filler', 'lip fillers', 'cheek filler'],
  'Juvederm': ['juvederm', 'juvéderm'],
  'Restylane': ['restylane'],
  'Sculptra': ['sculptra'],
  'Microneedling': ['microneedling', 'micro-needling', 'collagen induction therapy', 'skinpen'],
  'RF Microneedling': ['rf microneedling', 'radiofrequency microneedling', 'morpheus8', 'morpheus 8', 'vivace'],
  'CoolSculpting': ['coolsculpting', 'cryolipolysis', 'fat freezing'],
  'IPL': ['ipl', 'intense pulsed light', 'photofacial', 'photo facial'],
  'Laser hair removal': ['laser hair removal', 'lhr', 'diode laser hair'],
  'Laser skin resurfacing': ['laser resurfacing', 'fractional laser', 'co2 laser', 'fraxel'],
  'HydraFacial': ['hydrafacial', 'hydra facial', 'hydra-facial'],
  'Chemical peel': ['chemical peel', 'chemical peels', 'glycolic peel', 'tca peel'],
  'Microdermabrasion': ['microdermabrasion', 'dermaplaning', 'dermaplane'],
  'Kybella': ['kybella', 'deoxycholic acid'],
  'PRP': ['prp', 'platelet-rich plasma', 'platelet rich plasma', 'vampire facial'],
  'PDO threads': ['pdo thread', 'pdo threads', 'thread lift'],
  'GLP-1 weight loss': ['glp-1', 'glp1', 'medical weight loss', 'weight loss injection', 'weight management program'], // brand drug names intentionally NOT listed (EIN/AEO rule)
  'Hormone therapy': ['hormone therapy', 'hrt', 'bioidentical hormones', 'bhrt'],
  'IV therapy': ['iv therapy', 'iv drip', 'vitamin drip', 'iv hydration'],
  'Ultherapy': ['ultherapy', 'ultrasound skin tightening'],
  'Emsculpt': ['emsculpt', 'emsculpt neo', 'muscle toning'],
};

/** Treatment brands that are also legitimate org/product entities (own Wikidata items). */
const BRANDS = {
  'Allergan': ['allergan', 'abbvie aesthetics'],
  'Galderma': ['galderma'],
  'Merz Aesthetics': ['merz', 'merz aesthetics'],
};

/** Conditions/concerns a med-spa addresses (drive informational fan-out). */
const CONDITIONS = {
  'Wrinkles': ['wrinkles', 'fine lines', 'crow’s feet', "crow's feet", 'frown lines', 'forehead lines'],
  'Acne': ['acne', 'acne scars', 'breakouts'],
  'Hyperpigmentation': ['hyperpigmentation', 'melasma', 'sun spots', 'age spots', 'dark spots'],
  'Rosacea': ['rosacea', 'facial redness'],
  'Skin laxity': ['skin laxity', 'sagging skin', 'loose skin', 'skin tightening'],
  'Cellulite': ['cellulite'],
  'Hair loss': ['hair loss', 'thinning hair', 'alopecia'],
};

/** Clinician professions (E-E-A-T entity signals). */
const PROFESSIONS = {
  'Board-certified dermatologist': ['dermatologist', 'board-certified dermatologist', 'derm'],
  'Plastic surgeon': ['plastic surgeon', 'cosmetic surgeon'],
  'Nurse practitioner': ['nurse practitioner', 'np', 'aesthetic nurse', 'rn injector'],
  'Physician assistant': ['physician assistant', 'pa-c'],
  'Medical director': ['medical director'],
};

/** Map each gazetteer table to its entity kind + default schema.org type. */
const TABLES = [
  ['treatment', 'MedicalProcedure', TREATMENTS],
  ['brand', 'Brand', BRANDS],
  ['condition', 'MedicalCondition', CONDITIONS],
  ['profession', 'Occupation', PROFESSIONS],
];

/** Build a flat alias→canonical lookup once (longest alias first = greedy match). */
function buildLexicon() {
  const entries = [];
  for (const [kind, schemaType, table] of TABLES) {
    for (const [canonical, syns] of Object.entries(table)) {
      const all = [canonical, ...syns].map((s) => s.toLowerCase());
      for (const alias of new Set(all)) entries.push({ alias, canonical, kind, schemaType });
    }
  }
  // Longest alias first so "rf microneedling" wins over "microneedling".
  entries.sort((a, b) => b.alias.length - a.alias.length);
  return entries;
}

const LEXICON = buildLexicon();

/** Escape a string for use in a RegExp. */
function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Visible, de-chromed text for matching (drop script/style/nav/footer noise). */
function pageText($) {
  const clone = $.root().clone();
  clone.find('script, style, noscript, svg, template').remove();
  return clone.text().replace(/\s+/g, ' ').trim();
}

/** Count whole-phrase occurrences of an alias in lowercased text (word-boundary-ish). */
function countAlias(textLc, alias) {
  const re = new RegExp(`(?:^|[^a-z0-9])${reEscape(alias)}(?=$|[^a-z0-9])`, 'g');
  let n = 0; while (re.exec(textLc)) n++;
  return n;
}

/** Heuristic location extraction: "<service> in <City, ST>" / "<City>, <ST 2-letter>". */
function extractLocations(text) {
  const out = new Map();
  const re = /\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2}),\s*([A-Z]{2})\b/g;
  let m;
  while ((m = re.exec(text))) {
    const name = `${m[1]}, ${m[2]}`;
    out.set(name.toLowerCase(), { canonical: name, kind: 'location', schemaType: 'Place', count: (out.get(name.toLowerCase())?.count || 0) + 1 });
  }
  return [...out.values()];
}

/**
 * Extract entities from one page's RAW HTML.
 * Reuses the crawler's text (no new fetch). Brand/Org sameAs resolution is OPTIONAL and
 * happens via sources/entity.mjs when cfg.brand matches the page's primary org.
 *
 * @param {string} html  raw HTML (as crawl.mjs returns it)
 * @param {string} url   page URL (for @id minting downstream)
 * @param {object} cfg   client config (cfg.brand, cfg.baseUrl, cfg.aliases)
 * @returns {{url:string, title:string, org:object|null, entities:Array, about:object|null, mentions:Array}}
 */
export function extractEntities(html, url, cfg = {}) {
  const $ = cheerio.load(html || '');
  const title = ($('head > title').first().text() || '').trim();
  const h1 = $('h1').first().text().trim();
  const text = pageText($);
  const textLc = text.toLowerCase();
  const headLc = `${title} ${h1}`.toLowerCase();

  // 1) Gazetteer pass — fold aliases into canonical entities, track count + head-presence.
  const byCanon = new Map();
  for (const { alias, canonical, kind, schemaType } of LEXICON) {
    const count = countAlias(textLc, alias);
    if (!count) continue;
    const inHead = headLc.includes(alias);
    const cur = byCanon.get(canonical);
    if (cur) { cur.count += count; cur.inHead = cur.inHead || inHead; cur.synonyms.add(alias); }
    else byCanon.set(canonical, { name: canonical, kind, schemaType, count, inHead, synonyms: new Set([alias]) });
  }

  // 2) Location heuristic (separate kind; used for LocalBusiness areaServed downstream).
  for (const loc of extractLocations(text)) {
    const cur = byCanon.get(loc.canonical);
    if (cur) cur.count += loc.count;
    else byCanon.set(loc.canonical, { name: loc.canonical, kind: loc.kind, schemaType: loc.schemaType, count: loc.count, inHead: headLc.includes(loc.canonical.toLowerCase()), synonyms: new Set() });
  }

  // 3) The page's own brand/org (if the brand string appears) — the org node candidate.
  const brand = cfg.brand;
  let org = null;
  const brandAliases = [brand, ...(cfg.aliases || [])].filter(Boolean).map((s) => String(s).toLowerCase());
  const brandCount = brandAliases.reduce((n, a) => n + countAlias(textLc, a), 0);
  if (brand && (brandCount > 0 || headLc.includes(String(brand).toLowerCase()))) {
    org = { name: brand, kind: 'organization', schemaType: 'Organization', count: brandCount || 1, inHead: brandAliases.some((a) => headLc.includes(a)), synonyms: cfg.aliases || [] };
  }

  // 4) Score + rank. `about` = the single highest-scoring on-topic entity (head presence
  //    weighted heavily, since the H1/title is what the page is genuinely ABOUT). Org is
  //    not counted as `about` for a service page — the treatment is.
  const scored = [...byCanon.values()].map((e) => ({
    name: e.name, kind: e.kind, schemaType: e.schemaType, count: e.count,
    synonyms: [...e.synonyms].filter((s) => s.toLowerCase() !== e.name.toLowerCase()),
    score: e.count + (e.inHead ? 10 : 0) + (e.kind === 'treatment' ? 2 : 0),
  })).sort((a, b) => b.score - a.score);

  // Prefer a treatment/condition for `about`; fall back to top-scored, else org.
  const topical = scored.filter((e) => e.kind === 'treatment' || e.kind === 'condition' || e.kind === 'brand');
  const about = topical[0] || scored[0] || (org ? { name: org.name, kind: org.kind, schemaType: org.schemaType, count: org.count, synonyms: org.synonyms, score: 0 } : null);
  const mentions = scored.filter((e) => e.name !== about?.name);

  return { url, title, org, entities: scored, about, mentions };
}

/**
 * Resolve the org entity to its sameAs graph (Wikidata + Google KG, FREE) by reusing
 * sources/entity.mjs. Optional + best-effort; callers pass the resolved sameAs into the graph.
 * @returns {Promise<{sameAs:string[], wikidata:object|null, google:object|null, issues:string[]}>}
 */
export async function resolveOrgSameAs(cfg, { log = () => {} } = {}) {
  try {
    const { entityConsistency } = await import('../sources/entity.mjs');
    const r = await entityConsistency(cfg, { log });
    return { sameAs: r.recommendedSameAs || [], wikidata: r.wikidata || null, google: r.google || null, issues: r.issues || [] };
  } catch (e) {
    return { sameAs: [], wikidata: null, google: null, issues: ['resolve: ' + String(e.message || e)] };
  }
}

/** Exposed for tests/inspection. */
export const _gazetteer = { TREATMENTS, BRANDS, CONDITIONS, PROFESSIONS, LEXICON };
