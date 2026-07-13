// seo-bot · listings/targets — the verified med-spa local-citation registry (June 2026).
// Ordering IS the playbook: Tier 0 (canonical NAP) blocks everything; Tier 1 free
// entity graph first; then booking/Reserve; then free aggregators; then AI-cited
// directories; paid last (owner-approval only). `automatable`:
//   auto       = the bot does it (on-site embed/schema/NAP audit) via the apply adapters
//   flag-track = bot queues + tracks status; a human submits (no free public API)
//   manual     = bot only generates the row + monitors; a human claims/verifies
// COMPLIANCE: the bot NEVER automates incentivized/gated/in-lobby review solicitation
// (Google early-2026 suspension risk; FTC $4.2M gating fine). Tracking counts is fine.

export const CITATION_TARGETS = [
  // ---- Tier 1 — FREE core entity graph (highest 2026 AEO value; do same week) ----
  { id: 'gbp', tier: 1, name: 'Google Business Profile', url: 'https://business.google.com/create', kind: 'entity-graph', free: true, automatable: 'manual',
    napRule: 'Exact canonical NAP. Primary category "Medical Spa" + service categories (Botox, laser, etc.).', note: '~1/3 of local ranking; feeds Google AI Overviews. Mail/phone verify.' },
  { id: 'apple-business', tier: 1, name: 'Apple Business Connect', url: 'https://business.apple.com/', kind: 'entity-graph', free: true, automatable: 'manual',
    napRule: 'Exact canonical NAP.', note: 'Unified "Apple Business" (Apr 2026); feeds Maps/Spotlight/Siri/Apple Intelligence "World Knowledge Answers". LOW competition — biggest underused edge. LEAD HERE.' },
  { id: 'bing-places', tier: 1, name: 'Bing Places for Business', url: 'https://www.bing.com/business', kind: 'entity-graph', free: true, automatable: 'manual',
    napRule: 'Exact canonical NAP. One-click Import-from-Google available.', note: 'Feeds Bing + Copilot AI answers. bingplaces.com redirects here (since Oct 2025).' },

  // ---- Tier 2 — Booking + Reserve-with-Google (conversion + book-now schema) ----
  { id: 'booking-embed', tier: 2, name: 'Self-booking embed on the owned site', url: 'https://www.joinblvd.com/features/self-booking', kind: 'booking', free: true, automatable: 'auto',
    napRule: 'White-labeled (spa brand). Boulevard / Vagaro / Mindbody / Zenoti.', note: 'Bot inserts the embed (Next.js PR / WP REST). Boulevard = booking/EMR SaaS, not a directory.' },
  { id: 'reserve-with-google', tier: 2, name: 'Reserve with Google (via booking SaaS)', url: 'https://support.boulevard.io/en/articles/6790178-reserve-with-google-integration', kind: 'booking', free: true, automatable: 'flag-track',
    napRule: 'Booking-SaaS business name/address MUST exactly match GBP.', note: 'MANUAL enable in the SaaS (Apps & Integrations); ~2wk lag; US-only; all-locations; breaks with custom booking; one source says needs Boulevard Premium (+$150/mo). Bot detects NAP-match precondition, queues, then verifies the "Book" button on GBP.' },
  { id: 'localbusiness-schema', tier: 2, name: 'LocalBusiness/MedicalBusiness + ReserveAction schema', url: 'https://schema.org/MedicalBusiness', kind: 'on-site', free: true, automatable: 'auto',
    napRule: 'Schema NAP must equal canonical NAP.', note: 'Handled by the med-spa rule pack (medspa-nap-schema, booking-action) + apply adapter.' },

  // ---- Tier 3 — FREE aggregators (silent downstream propagation, ~80% of US distribution) ----
  { id: 'data-axle', tier: 3, name: 'Data Axle', url: 'https://www.data-axle.com/our-data/business-data/', kind: 'aggregator', free: true, automatable: 'flag-track',
    napRule: 'Exact canonical NAP.', note: 'Free direct claim/update portal; feeds Yahoo, Bing, Apple Maps. No public API.' },
  { id: 'foursquare', tier: 3, name: 'Foursquare for Business', url: 'https://business.foursquare.com/', kind: 'aggregator', free: true, automatable: 'flag-track',
    napRule: 'Exact canonical NAP.', note: 'Free claim + verify; powers Uber/Apple/Nextdoor location data. No public API.' },

  // ---- Tier 4 — AI-cited directories (compounding AEO surface; mostly nofollow) ----
  { id: 'yelp', tier: 4, name: 'Yelp', url: 'https://biz.yelp.com/', kind: 'directory', free: true, automatable: 'manual', napRule: 'Exact NAP + photos.', note: 'Cited by ChatGPT/Perplexity local answers.' },
  { id: 'realself', tier: 4, name: 'RealSelf', url: 'https://www.realself.com/dashboard', kind: 'directory', free: true, automatable: 'manual', napRule: 'Exact NAP.', note: 'Aesthetics-specific, high-intent.' },
  { id: 'healthgrades', tier: 4, name: 'Healthgrades', url: 'https://www.healthgrades.com/provider-resources', kind: 'directory', free: true, automatable: 'manual', napRule: 'Exact NAP + provider credentials.', note: 'YMYL/medical trust signal.' },
  { id: 'zocdoc', tier: 4, name: 'Zocdoc', url: 'https://www.zocdoc.com/join', kind: 'directory', free: false, automatable: 'manual', napRule: 'Exact NAP.', note: 'Booking-oriented; paid provider listing.' },
  { id: 'state-medical-board', tier: 4, name: 'State medical board directory', url: '', kind: 'directory', free: true, automatable: 'manual', napRule: 'Verify provider licenses are listed + accurate.', note: 'YMYL trust — confirm the supervising physician/NP license is public + matches.' },

  // ---- Tier 5 — PAID managed syndication (owner approval ONLY) ----
  { id: 'yext', tier: 5, name: 'Yext / Uberall (managed syndication)', url: 'https://www.yext.com/', kind: 'paid-syndication', free: false, automatable: 'manual',
    napRule: 'Exact canonical NAP.', note: 'REQUIRES OWNER OK. Rental lock-in: listings revert if you stop paying — poor fit for durable owned assets. Multi-location only.' },
];

export const TIER_LABELS = {
  1: 'Tier 1 — Free core entity graph (do first)',
  2: 'Tier 2 — Booking + Reserve-with-Google',
  3: 'Tier 3 — Free data aggregators',
  4: 'Tier 4 — AI-cited directories',
  5: 'Tier 5 — Paid syndication (owner approval only)',
};
