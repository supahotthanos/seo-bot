// seo-bot · measure/discover — per-CLIENT prompt + tracking discovery. Each bot instance is
// dedicated to ONE business, so its AI-visibility panel must be that business's real demand —
// not a generic "best med spas". This builds the prompt set from the client's own services ×
// locations × brand × competitors, then augments with REAL demand (GSC queries the site
// already shows for) and natural patient phrasing from the model (on the subscription). The
// panel drives measure → sources → brief, all per client. Deterministic core is unit-tested.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, CONFIG_DIR } from '../config.mjs';

const DEFAULT_SERVICES = ['botox', 'lip filler', 'dermal fillers', 'morpheus8', 'laser hair removal', 'microneedling', 'coolsculpting', 'chemical peel'];

function geosOf(cfg) {
  const g = cfg.serviceAreaGeos || (cfg.locations || []).map((l) => l.nap?.city || l.name).filter(Boolean) || [];
  if (g.length) return [...new Set(g)].slice(0, 5);
  if (cfg.geo?.city) return [cfg.geo.city];
  if (cfg.listings?.canonicalNap?.city) return [cfg.listings.canonicalNap.city];
  return [];
}

/** Deterministic per-client prompt panel from services × geos × brand × competitors. Pure. */
export function generatePrompts(cfg) {
  const brand = cfg.brand;
  const services = (cfg.services?.length ? cfg.services : DEFAULT_SERVICES).slice(0, 6);
  const geos = geosOf(cfg);
  const competitors = (cfg.competitors || []).filter((c) => !/google maps|yelp/i.test(c)).slice(0, 2);
  const out = new Set();

  // Brand-intent (only if we actually have a brand — never emit "undefined reviews").
  if (brand) { out.add(`${brand} reviews`); out.add(`is ${brand} legit`); }

  for (const city of geos.length ? geos : [null]) {
    const inCity = city ? ` in ${city}` : '';
    out.add(`best med spa${inCity}`.trim());
    if (city) out.add(`med spa near me ${city}`);
    for (const s of services) {
      out.add(`best ${s}${inCity}`.trim());
      out.add(`${s} cost${inCity}`.trim());
      out.add(`is ${s} worth it`);
      if (city) out.add(`where to get ${s} in ${city}`);
    }
  }
  if (brand) for (const c of competitors) out.add(`${brand} vs ${c}`);
  // Decision/safety intents (vertical-agnostic patient questions)
  for (const s of services.slice(0, 3)) out.add(`is ${s} safe`);

  return [...out].filter((p) => p && !/\{.*\}/.test(p) && !/\bundefined\b|\bnull\b/i.test(p)).slice(0, 30);
}

/** Augment the deterministic panel with REAL GSC demand + natural model phrasing. */
export async function discoverPrompts(cfg, { log = () => {}, useGSC = true, useLLM = true, max = 30 } = {}) {
  const base = generatePrompts(cfg);
  const found = new Set(base);

  // (1) real demand: the queries the site already gets impressions for (highest-signal).
  if (useGSC) {
    try {
      const { pullGSC } = await import('../gsc.mjs');
      const g = await pullGSC(cfg, { log: () => {} });
      if (g.enabled) for (const q of (g.queries || []).slice(0, 12)) { const t = (q.keys?.[0] || '').trim(); if (t && t.split(' ').length >= 2) found.add(t); }
    } catch { /* */ }
  }

  // (2) natural patient phrasing for THIS business, on the subscription.
  if (useLLM) {
    try {
      const { complete, llmAvailable } = await import('../llm.mjs');
      if (llmAvailable()) {
        const profile = `Brand: ${cfg.brand}. Services: ${(cfg.services?.length ? cfg.services : DEFAULT_SERVICES).slice(0, 6).join(', ')}. Cities: ${geosOf(cfg).join(', ') || 'n/a'}.`;
        const text = await complete(`Generate 12 short, natural questions a real PATIENT would type into ChatGPT or Google when choosing a med spa for this business. Mix intents: best-of, cost, safety, comparison, "near me", and brand. ${profile}\nOutput ONE question per line, no numbering, no quotes.`, { maxTokens: 400, client: cfg.name, tag: 'discover' });
        for (const line of String(text || '').split('\n').map((l) => l.replace(/^[\d.\-*\s"]+/, '').trim()).filter((l) => l.length > 6 && l.split(' ').length >= 3)) found.add(line.toLowerCase());
      }
    } catch { /* */ }
  }

  // prioritize: brand-intent + city×service first, dedup, cap
  const arr = [...found];
  arr.sort((a, b) => score(b, cfg) - score(a, cfg));
  const panel = arr.slice(0, max);
  log(`  Discovered ${panel.length} client-specific prompts for ${cfg.brand} (${base.length} templated${useGSC ? ' + GSC demand' : ''}${useLLM ? ' + model phrasing' : ''}).`);
  return { panel, base };
}

function score(p, cfg) {
  let s = 0;
  if (cfg.brand && p.toLowerCase().includes(cfg.brand.toLowerCase())) s += 5;
  for (const g of geosOf(cfg)) if (p.toLowerCase().includes(g.toLowerCase())) s += 2;
  if (/\b(best|cost|near me|worth it|vs|reviews?)\b/.test(p)) s += 1;
  return s;
}

/** Write the discovered panel into the client config's promptPanel. */
export async function writePromptPanel(cfg, panel, { log = () => {} } = {}) {
  const file = join(CONFIG_DIR, `${cfg.name}.json`);
  const raw = JSON.parse(readFileSync(file, 'utf-8'));
  raw.promptPanel = panel;
  writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  log(`  Wrote ${panel.length} prompts → ${file} (measure/serp now track these).`);
}
