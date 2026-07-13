// seo-bot · measure/offsite-radar — the OFF-PAGE lane (operator: "look at everything they've done,
// even off-page stuff"). Where do the winners live OFF their own domains? On one residential IP we
// can't run a backlink crawler, but we already own two signals that reveal the off-page surface for
// free: (1) the Google SERPs — the directories/press that rank ALONGSIDE clinics for the money
// queries are the listing/citation surfaces every winner sits on; (2) the ChatGPT citations — the
// sources the AI engines actually pull from. Cross-referenced, they produce the off-page target map:
// the directories to be listed on and the press to earn, ranked by how universally the winners
// appear there, with a GAP flag when our own domain is absent. Pure + testable; no new network.

const host = (u = '') => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

// Off-page surface taxonomy — how to ACT on each kind of target.
const SURFACE = [
  [/(^|\.)yelp\./, 'directory', 'Claim + optimize the Yelp listing (photos, services, respond to reviews)'],
  [/(^|\.)(realself)\./, 'directory', 'Build a RealSelf provider profile with before/afters + Q&A answers'],
  [/(^|\.)(zocdoc|healthgrades|vitals|wellness|vagaro|booksy)\./, 'directory', 'Create/claim the booking-directory profile'],
  [/(^|\.)(google|maps)\./, 'directory', 'Google Business Profile — the map pack is the prize'],
  [/(^|\.)(groupon)\./, 'directory', 'Groupon presence (promo-led; watch brand dilution)'],
  [/(^|\.)(tripadvisor|nextdoor|thumbtack|angi|bbb)\./, 'directory', 'Secondary directory listing'],
  [/(^|\.)(reddit|quora)\./, 'forum', 'Earn an authentic mention in the ranking thread (disclosed)'],
  [/(^|\.)(instagram|tiktok|youtube|facebook|linkedin|threads|pinterest)\./, 'social', 'Own the social profile that ranks'],
  [/(^|\.)(allure|vogue|glamour|byrdie|cosmopolitan|elle|harpersbazaar|newbeauty|instyle|marieclaire|refinery29|thecut|purewow|wwd|townandcountry)\./, 'press-beauty', 'Pitch the beauty/editorial desk for a feature or roundup inclusion'],
  [/(^|\.)(observer|modernluxury|nymag|timeout|nypost|latimes|chicagomag|phillymag|bostonmagazine|dmagazine|miaminewtimes|laweekly|culturemap|secretnyc|patch|forbes|usatoday)\./, 'press-local', 'Pitch the local/city-magazine "best of" list editor'],
  [/(^|\.)(threebestrated|expertise|medspascout|spalens|beautyplaces|medicalspalocator|discovermedspa|scoredoc|birdeye)\./, 'directory-niche', 'Submit to the niche med-spa "best of" directory'],
];
const classifySurface = (h) => { for (const [re, kind, action] of SURFACE) if (re.test(h)) return { kind, action }; return null; };

/** PURE: the off-page surface map from SERP + ChatGPT observations. Each surface ranked by reach
 *  (distinct cities/queries it appears for), with our-domain presence flagged as covered/GAP. */
export function offsiteSurfaceMap({ serpObservations = [], chatgptObservations = [], ourDomain = '', max = 40 } = {}) {
  const ours = host(ourDomain);
  const acc = new Map();
  const bump = (h, { city, query, source, ourHit }) => {
    const surf = classifySurface(h);
    if (!surf) return;
    const r = acc.get(h) || { domain: h, kind: surf.kind, action: surf.action, hits: 0, cities: new Set(), queries: new Set(), sources: new Set(), weAppear: false };
    r.hits++; if (city) r.cities.add(city); if (query) r.queries.add(query); r.sources.add(source);
    if (ourHit) r.weAppear = true;
    acc.set(h, r);
  };
  for (const o of serpObservations) {
    if (!o || o.status !== 'ok') continue;
    let ourInThisSerp = false;
    for (const res of (o.results || [])) if (ours && host(res.url) === ours) ourInThisSerp = true;
    for (const res of (o.results || [])) bump(host(res.url), { city: o.city, query: o.query, source: 'serp', ourHit: false });
    // Mark whether WE ranked in this SERP (informs the gap analysis at the surface level below).
    if (ourInThisSerp) for (const res of (o.results || [])) { const r = acc.get(host(res.url)); if (r) r.coRankedWithUs = (r.coRankedWithUs || 0) + 1; }
  }
  for (const o of chatgptObservations) {
    if (!o || o.status !== 'ok') continue;
    for (const u of (o.citations?.urls || [])) bump(host(u), { city: o.city, query: o.promptText || o.query, source: 'chatgpt' });
  }
  return [...acc.values()]
    .map((r) => ({ domain: r.domain, kind: r.kind, action: r.action, reach: r.cities.size, queries: r.queries.size, hits: r.hits, sources: [...r.sources], weAppear: r.weAppear, gap: !r.weAppear }))
    .sort((a, b) => b.reach - a.reach || b.hits - a.hits)
    .slice(0, max);
}

/** PURE: condense the map into a prioritized off-page ACTION list (the biggest-reach gaps first). */
export function offsiteActions(surfaceMap = []) {
  return surfaceMap
    .filter((s) => s.gap && s.kind !== 'social')       // social handled separately; gaps = opportunity
    .map((s) => ({ target: s.domain, kind: s.kind, reach: s.reach, action: s.action, priority: s.reach * (s.kind.startsWith('press') ? 1.3 : 1) }))
    .sort((a, b) => b.priority - a.priority);
}

export function renderOffsiteMapMd(surfaceMap = [], { brand = '', ourDomain = '' } = {}) {
  const byKind = {};
  for (const s of surfaceMap) (byKind[s.kind] = byKind[s.kind] || []).push(s);
  const actions = offsiteActions(surfaceMap);
  const L = [
    `# Off-page surface map — where the winners live off their own sites`, '',
    `Derived from the Google SERPs + ChatGPT citations (no backlink crawler). These are the directories, forums, and press the winning med spas appear on for the money queries — the off-page targets for ${brand || ourDomain}. "GAP" = a high-reach surface where ${ourDomain || 'we'} do NOT appear.`, '',
    '## Top off-page targets (by reach across cities/queries)',
    '| surface | kind | reach (cities) | appearances | we appear? | how to act |',
    '|---------|------|----------------|-------------|-----------|------------|',
    ...surfaceMap.slice(0, 25).map((s) => `| ${s.domain} | ${s.kind} | ${s.reach} | ${s.hits} | ${s.weAppear ? '✓' : '**GAP**'} | ${s.action} |`),
    '', '## Prioritized off-page action list (biggest-reach gaps first)',
    ...(actions.length ? actions.slice(0, 15).map((a, i) => `${i + 1}. **${a.target}** (${a.kind}, reach ${a.reach}) — ${a.action}`) : ['_no gaps: we already appear on every surface captured_']),
    '', '_Reach = distinct cities the surface ranks/cited in. Press targets weighted higher (earned media compounds). Merge with thread-radar for the forum lane._',
  ];
  return L.join('\n');
}
