// seo-bot · measure/query-bank — our in-house "Peec AI" prompt registry + panel primitives.
//
// A query bank is the MANAGED set of prompts we track over time, structured so we can measure how
// the AI answer varies by the three levers a quant cares about:
//   1) DAY        — same prompt, different days (temporal volatility of the ranking)
//   2) SPELLING   — same intent, different phrasing/spelling ("med spa" vs "medspa" vs "medical spa")
//   3) ENGINE     — ChatGPT vs Perplexity vs Google AI Overview (do the engines disagree?)
// Every capture becomes one row in an append-only PANEL (observations.ndjson), stamped with all of
// these dimensions, so the analytics layer can hold any factors fixed and attribute the variance.
//
// PURE + testable. No browser, no IO — expansion and normalization only. The runner consumes this.

import { US_MEDSPA_MARKETS } from './markets.mjs';

export const ENGINES = ['chatgpt', 'perplexity', 'aio']; // ChatGPT · Perplexity · Google AI Overview
export const CHATGPT_TIERS = ['low', 'medium', 'high'];   // reasoning tiers (only ChatGPT varies here)

// The geo grid = the canonical US med-spa market list (src/measure/markets.mjs, ~65 metros).
// "Every city" accrues over many safe runs; ChatGPT has no IP risk, so this runs to the account cap.
export const MEDSPA_CITIES = US_MEDSPA_MARKETS;

// The med-spa query bank. Each query is one INTENT with several spelling/phrasing VARIANTS so we can
// A/B how the wording moves the ranking. {city} is filled per market. Grow this file freely — it is
// the thing that makes this "our own Peec AI": add intents, add variants, add verticals. Covers the
// full money-intent surface: overall-best, per-service (botox/filler/laser/etc.), price, reviews.
export const MEDSPA_QUERY_BANK = {
  vertical: 'medspa',
  cities: MEDSPA_CITIES,
  engines: ['chatgpt'],        // default run surface (Perplexity/AIO opt-in per run)
  tiers: ['low'],              // start on low (Instant — cheap, high cap); ramp to medium/high via cron
  queries: [
    { id: 'best', intent: 'best med spas', variants: [
      { id: 'v1', template: 'best med spas in {city}' },              // canonical
      { id: 'v2', template: 'best medspa {city}' },                    // one word, no "in"
      { id: 'v3', template: 'best medical spa in {city}' },            // spelled out
      { id: 'v4', template: 'top rated med spas near {city}' },        // "top rated" + "near"
      { id: 'v5', template: 'who are the best med spas in {city}?' },  // question form
    ] },
    { id: 'botox', intent: 'where to get botox', variants: [
      { id: 'v1', template: 'where should I get Botox in {city}' },
      { id: 'v2', template: 'best place for botox {city}' },
      { id: 'v3', template: 'best botox in {city}' },
    ] },
    { id: 'filler', intent: 'fillers / lip filler', variants: [
      { id: 'v1', template: 'best med spa for fillers in {city}' },
      { id: 'v2', template: 'where to get lip filler in {city}' },
    ] },
    { id: 'laser', intent: 'laser hair removal', variants: [
      { id: 'v1', template: 'best laser hair removal in {city}' },
      { id: 'v2', template: 'best med spa for laser hair removal {city}' },
    ] },
    { id: 'skin', intent: 'skin treatments / facials', variants: [
      { id: 'v1', template: 'best medical spa for facials in {city}' },
      { id: 'v2', template: 'best place for microneedling in {city}' },
    ] },
    { id: 'body', intent: 'body contouring / coolsculpting', variants: [
      { id: 'v1', template: 'best coolsculpting in {city}' },
      { id: 'v2', template: 'best med spa for body contouring {city}' },
    ] },
    { id: 'weightloss', intent: 'medical weight loss / GLP-1', variants: [
      { id: 'v1', template: 'best medical weight loss clinic in {city}' },
      { id: 'v2', template: 'where to get semaglutide in {city}' },
    ] },
    { id: 'price', intent: 'cost / affordability', variants: [
      { id: 'v1', template: 'how much is Botox in {city}' },
      { id: 'v2', template: 'affordable med spa in {city}' },
    ] },
    { id: 'reviews', intent: 'trust / reviews', variants: [
      { id: 'v1', template: 'most reputable med spa in {city} with real reviews' },
      { id: 'v2', template: 'med spa in {city} with the best reviews' },
    ] },
    // AdWords-style TRANSACTIONAL terms (Shubh 2026-07-20: "fan-out query, AdWords term style,
    // everything") — deal/booking phrasing is how a ready-to-buy customer talks to ChatGPT, and
    // the fan-outs + sources behind these are the highest-commercial-intent placement targets.
    { id: 'deals', intent: 'transactional: deals / booking (adwords-style)', variants: [
      { id: 'v1', template: 'botox deals in {city}' },
      { id: 'v2', template: 'med spa specials in {city}' },
      { id: 'v3', template: 'book a botox appointment in {city}' },
    ] },
  ],
};

// SELF-AEO bank (Shubh 2026-07-16): the questions OUR prospects ask AI when they want what
// SeenAI sells. Same Sturm capture machinery as the med-spa bank, pointed at ourselves — the
// fan-out sub-queries tell us what ChatGPT actually researches, and the cited sources are the
// ranked list of PLACES TO GET SEENAI PLACED. Non-geo intent → single '' city cell; audience
// variants live in the templates. Deliberately small (shares the same account budget as the
// med-spa lane): run via `seenai-fanout`, capped, never a KeepAlive loop.
export const SEENAI_QUERY_BANK = {
  vertical: 'ai-seo-agency',
  cities: [''],
  engines: ['chatgpt'],
  tiers: ['low'],
  queries: [
    { id: 'rank-on-chatgpt', intent: 'get my business recommended by ChatGPT', variants: [
      { id: 'v1', template: 'what is the best company to get my business ranked on ChatGPT' },
      { id: 'v2', template: 'how can I get my company recommended by ChatGPT' },
      { id: 'v3', template: 'who can get my business to show up in ChatGPT answers' },
    ] },
    { id: 'ai-seo-company', intent: 'best AI SEO company', variants: [
      { id: 'v1', template: 'best AI SEO company' },
      { id: 'v2', template: 'best AI SEO agency 2026' },
      { id: 'v3', template: 'top AI search optimization companies' },
    ] },
    { id: 'aeo-agency', intent: 'best AEO/GEO agency', variants: [
      { id: 'v1', template: 'best answer engine optimization agency' },
      { id: 'v2', template: 'best generative engine optimization (GEO) agency' },
    ] },
    { id: 'ai-visibility', intent: 'AI visibility tracking/services', variants: [
      { id: 'v1', template: 'who offers AI search visibility tracking for my business' },
      { id: 'v2', template: 'best tools or agencies to monitor how ChatGPT talks about my brand' },
    ] },
    { id: 'medspa-vertical', intent: 'vertical: med spa marketing via AI search', variants: [
      { id: 'v1', template: 'best SEO agency for med spas' },
      { id: 'v2', template: 'how do I get my med spa recommended on ChatGPT' },
    ] },
    // AdWords-style commercial terms for OUR funnel (Shubh 2026-07-20): hire/cost phrasing is
    // what a med-spa owner types when they're ready to pay — whoever owns these answers gets
    // the call, and the cited sources are where SeenAI's pricing/services pages must appear.
    { id: 'hire-pricing', intent: 'hiring / pricing an AI-SEO agency (adwords-style)', variants: [
      { id: 'v1', template: 'how much does AI SEO for a med spa cost' },
      { id: 'v2', template: 'hire an SEO agency for my med spa' },
      { id: 'v3', template: 'SEO services for med spas pricing' },
    ] },
  ],
};

/** PURE: expand a query bank into an ordered work-list of observation SPECS.
 *  Order is city-major → query → variant → engine → tier, so a single capped run naturally samples
 *  several spelling variants for the SAME city (enables same-day spelling comparison) before moving on.
 *  Overrides let a run narrow the grid (fewer cities, one engine, one tier, a subset of query ids). */
export function expandQueryBank(bank = MEDSPA_QUERY_BANK, overrides = {}) {
  const cities = (overrides.cities || bank.cities || MEDSPA_CITIES);
  const engines = (overrides.engines || bank.engines || ['chatgpt']);
  const tiers = (overrides.tiers || bank.tiers || ['low']);
  const onlyQ = overrides.queries ? new Set([].concat(overrides.queries)) : null; // subset of query ids
  const onlyV = overrides.variants ? new Set([].concat(overrides.variants)) : null; // subset of variant ids
  const specs = [];
  for (const city of cities) {
    for (const q of (bank.queries || [])) {
      if (onlyQ && !onlyQ.has(q.id)) continue;
      for (const v of (q.variants || [])) {
        if (onlyV && !onlyV.has(v.id)) continue;
        const promptText = String(v.template).replace(/\{city\}/g, city);
        for (const engine of engines) {
          // Reasoning tiers only mean something on ChatGPT; other engines get a single 'default' cell.
          const cellTiers = engine === 'chatgpt' ? tiers : ['default'];
          for (const tier of cellTiers) {
            specs.push({ queryId: q.id, intent: q.intent, variantId: v.id, template: v.template, promptText, engine, tier, city });
          }
        }
      }
    }
  }
  return specs;
}

/** PURE: stable string hash (FNV-1a, 32-bit) → 8-char hex. Deterministic (no Date/random) so the
 *  same answer text always yields the same id — lets us detect when an answer MATERIALLY changed. */
export function answerHash(text = '') {
  let h = 0x811c9dc5;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** PURE: a stable key for one observation CELL (everything except the day) — groups repeat samples
 *  of the identical prompt/engine/tier/city across days, which is exactly the day-variance unit. */
export function cellKey(spec = {}) {
  return [spec.engine, spec.queryId, spec.variantId, spec.tier, spec.city].map((x) => x ?? '').join('|');
}

const TOKENS = (s) => String(s).split(' ').filter(Boolean);
// Generic descriptors that don't distinguish one business from another — stripped so "Facile
// Dermatology + Boutique" and "Facile" collapse to the same brand. Conservative on purpose.
const GENERIC = /\b(med(ical)?\s*spa|medspa|spa|clinic|clinics|dermatology|derm|aesthetics?|aesthetic|wellness|institute|center|centre|boutique|plastic|surgery|surgical|laser|cosmetic|cosmetics|skin|studio|group|associates|by)\b/gi;

/** PURE: normalize a business name to a comparable brand key (lowercase, strip accents, drop generic
 *  descriptors + articles, collapse whitespace). "Rénouveau Med Spa" → "renouveau". Never empty-out a
 *  name that is ONLY generic words — falls back to the plain normalized form so nothing is lost. */
export function canonicalBrand(name = '') {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const stripped = base.replace(GENERIC, ' ').replace(/\b(the|a|an|of|in|at|for|and)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return stripped || base; // if stripping removed everything, keep the plain form
}

const isTokenPrefix = (short, long) => {
  const a = TOKENS(short), b = TOKENS(long);
  return a.length > 0 && a.length <= b.length && a.every((t, i) => t === b[i]);
};

/** PURE: unify chain variants across markets — map each raw name to a ROOT brand key, collapsing keys
 *  where one is a token-prefix of another ("skinspirit" ⊃ "skinspirit beverly hills"). Returns a
 *  Map(rawName → rootKey). Used so a chain shows up as ONE row in the cross-city leaderboard. */
export function unifyBrands(names = []) {
  const canon = [...new Set(names.map(canonicalBrand).filter(Boolean))]
    .sort((a, b) => TOKENS(a).length - TOKENS(b).length || a.localeCompare(b)); // shortest first = the root
  const roots = [];
  const toRoot = new Map();
  for (const c of canon) {
    const root = roots.find((r) => isTokenPrefix(r, c));
    if (root) toRoot.set(c, root); else { roots.push(c); toRoot.set(c, c); }
  }
  const out = new Map();
  for (const n of names) out.set(n, toRoot.get(canonicalBrand(n)) || canonicalBrand(n));
  return out;
}
