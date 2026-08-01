// seo-bot · locations — multi-location model for franchise / multi-site med-spa clients.
// The config was single-location (one NAP, one GBP); this adds a locations[] model with
// back-compat (synthesizes one location from the legacy fields), per-location coverage
// audit, per-location×service page briefs WITH A DOORWAY GUARD (Google penalizes
// near-duplicate "[service] in [city]" pages — every location page must carry genuinely
// unique local content), and a per-location GBP fan-out checklist.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { slugify, nowIso } from './util.mjs';

const DEFAULT_SERVICES = ['botox', 'dermal fillers', 'laser hair removal', 'microneedling', 'chemical peel', 'coolsculpting'];

function normLoc(l = {}) {
  return { name: l.name || l.nap?.name || 'Location', nap: l.nap || {}, geo: l.geo || null, gbp: l.gbp || null, pagePath: l.pagePath || null, services: l.services || [], unique: l.unique || l.uniqueContent || null };
}

/** Locations for a client. Falls back to a single synthesized location for back-compat. */
export function listLocations(cfg) {
  if (Array.isArray(cfg.locations) && cfg.locations.length) return cfg.locations.map(normLoc);
  const nap = cfg.listings?.canonicalNap || cfg.nap || {};
  return [normLoc({ name: cfg.brand, nap, geo: cfg.geo, gbp: cfg.gbp, pagePath: '/', unique: cfg.locationUnique })];
}

const napComplete = (n = {}) => !!(n.name && (n.street || n.address) && n.city && n.state && (n.zip || n.postal) && n.phone);
const napString = (n = {}) => [n.name, n.street || n.address, n.city, n.state, n.zip || n.postal, n.phone].filter(Boolean).join(' · ');

/** Per-location coverage audit + doorway-risk cross-check. */
export function auditLocations(cfg, { log = () => {} } = {}) {
  const locs = listLocations(cfg);
  const multi = locs.length > 1;
  const findings = locs.map((l) => {
    const issues = [];
    if (!napComplete(l.nap)) issues.push('incomplete NAP');
    if (!l.pagePath) issues.push('no dedicated location page (pagePath)');
    if (!(l.geo && l.geo.lat != null)) issues.push('no geo {lat,lng} — blocks geo-grid for this pin');
    if (multi && !(l.unique && String(l.unique).length > 40)) issues.push('no unique local content → DOORWAY-page risk');
    return { location: l.name, city: l.nap?.city || null, napOk: napComplete(l.nap), hasPage: !!l.pagePath, hasGeo: !!(l.geo && l.geo.lat != null), hasUnique: !!(l.unique && String(l.unique).length > 40), issues };
  });
  // Doorway cross-check: duplicate cities or all-identical NAP-minus-city.
  const cities = findings.map((f) => (f.city || '').toLowerCase()).filter(Boolean);
  const dupCities = cities.filter((c, i) => cities.indexOf(c) !== i);

  const L = [`# Locations — ${cfg.brand}`, `${locs.length} location(s)${multi ? '' : ' (single — synthesized from legacy fields)'} · ${nowIso()}`, ''];
  for (const f of findings) { L.push(`## ${f.location}${f.city ? ` (${f.city})` : ''}`); L.push(`- NAP ${f.napOk ? '✅' : '❌'} · page ${f.hasPage ? '✅' : '❌'} · geo ${f.hasGeo ? '✅' : '❌'} · unique-content ${f.hasUnique ? '✅' : '⚠️'}`); f.issues.forEach((i) => L.push(`  - [ ] ${i}`)); }
  if (dupCities.length) L.push('', `## ⚠️ Duplicate cities (${[...new Set(dupCities)].join(', ')}) — high doorway/cannibalization risk; differentiate or consolidate.`);

  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'locations.md'), L.join('\n'));
  log(`\n  Locations: ${locs.length} · ${findings.filter((f) => !f.issues.length).length} fully set · ${findings.filter((f) => f.issues.length).length} with gaps${dupCities.length ? ` · ⚠️ ${dupCities.length} duplicate cities` : ''}`);
  log(`  → ${join(dir, 'locations.md')}\n`);
  return { locations: locs, findings, doorwayRisk: dupCities.length > 0 || findings.some((f) => f.issues.some((i) => /DOORWAY/.test(i))) };
}

/** Per-location × service page briefs — each REQUIRES unique local content (doorway guard). */
export function locationPageBriefs(cfg) {
  const locs = listLocations(cfg);
  const services = (cfg.services?.length ? cfg.services : DEFAULT_SERVICES);
  const briefs = [];
  for (const l of locs) {
    const city = l.nap?.city || l.name;
    for (const s of services) {
      briefs.push({
        location: l.name, service: s, city,
        targetQuery: `${s} ${city}`.toLowerCase(),
        slug: slugify(`${s}-${city}`),
        // Doorway guard: the brief MUST be filled with location-specific facts before it can
        // pass the content gates (originality + data-grounding). uniqueSeed seeds that.
        requireUniqueLocalContent: true,
        uniqueSeed: l.unique || null,
        napForSchema: l.nap || null,
        gbp: l.gbp || null,
      });
    }
  }
  return briefs;
}

/** Per-location GBP optimization fan-out (business.manage; categories are the top lever). */
export function gbpFanout(cfg) {
  return listLocations(cfg).map((l) => ({
    location: l.name,
    checklist: [
      'Primary category: "Medical spa" (the single strongest local lever)',
      `NAP exact-match across web: ${napString(l.nap) || '⚠️ set NAP'}`,
      l.geo?.lat != null ? 'Address/pin verified' : '⚠️ set geo {lat,lng}',
      'Hours + holiday hours',
      'Services list with descriptions + price ranges',
      '2 Local Posts / month (offers, events)',
      '10+ real photos (exterior, interior, team, results w/ consent) — geo-tagging is DEBUNKED (Google strips EXIF; src/local/factors.mjs), the photos themselves are the value',
      'Seed 3-5 Q&A; respond to every review (never sentiment-gate — FTC 16 CFR 465)',
    ],
  }));
}
