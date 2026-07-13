// seo-bot · measure/markets — the canonical US med-spa MARKET GRID (single source of truth for
// BOTH lanes: Google serp-radar and ChatGPT query-bank/atlas). Ordered by competitiveness so a
// paced/capped run always covers the highest-value metros first; "every city" accrues over many
// safe runs. Extend freely — this is the geography of the proprietary engine.
//
// Selection = the markets where med-spa SEO/AEO is actually contested: the big metros, the
// affluent aesthetic hubs (Scottsdale, Beverly Hills, Newport Beach, Naples, Boca), and the
// fast-growing sunbelt/tech cities where clinics cluster. Tiered only for ordering.

export const MARKET_TIERS = {
  // Tier 1 — the biggest, most contested med-spa markets in the country.
  tier1: [
    'New York NY', 'Los Angeles CA', 'Miami FL', 'Chicago IL', 'Houston TX', 'Dallas TX',
    'Beverly Hills CA', 'Scottsdale AZ', 'Atlanta GA', 'Miami Beach FL',
  ],
  // Tier 2 — major metros + premier aesthetic destinations.
  tier2: [
    'Phoenix AZ', 'San Diego CA', 'Boston MA', 'Austin TX', 'Las Vegas NV', 'Seattle WA',
    'Denver CO', 'San Francisco CA', 'Nashville TN', 'Newport Beach CA', 'Naples FL',
    'Fort Lauderdale FL', 'Boca Raton FL', 'Tampa FL', 'Orlando FL', 'Charlotte NC',
  ],
  // Tier 3 — strong secondary markets + affluent suburbs where clinics concentrate.
  tier3: [
    'Philadelphia PA', 'Washington DC', 'San Antonio TX', 'Fort Worth TX', 'Portland OR',
    'Sacramento CA', 'San Jose CA', 'Irvine CA', 'Santa Monica CA', 'Pasadena CA',
    'La Jolla CA', 'Frisco TX', 'Plano TX', 'Brooklyn NY', 'Manhattan NY',
    'Palm Beach FL', 'Coral Gables FL', 'Aventura FL', 'Jacksonville FL', 'Charleston SC',
  ],
  // Tier 4 — the long tail of competitive metros (rounds out national coverage).
  tier4: [
    'Minneapolis MN', 'Detroit MI', 'Columbus OH', 'Indianapolis IN', 'Kansas City MO',
    'Salt Lake City UT', 'Raleigh NC', 'Savannah GA', 'Oklahoma City OK', 'Tucson AZ',
    'Boise ID', 'Cincinnati OH', 'Cleveland OH', 'Pittsburgh PA', 'St. Louis MO',
    'Milwaukee WI', 'Louisville KY', 'New Orleans LA', 'Richmond VA', 'Virginia Beach VA',
    'Baltimore MD', 'Greenwich CT', 'Bethesda MD', 'McLean VA', 'Buffalo NY',
  ],
};

/** The full ordered market grid (tier1 → tier4). ~65 metros. */
export const US_MEDSPA_MARKETS = [
  ...MARKET_TIERS.tier1, ...MARKET_TIERS.tier2, ...MARKET_TIERS.tier3, ...MARKET_TIERS.tier4,
];

/** First N markets (competitiveness order). */
export const topMarkets = (n = US_MEDSPA_MARKETS.length) => US_MEDSPA_MARKETS.slice(0, Math.max(1, n));
